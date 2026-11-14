import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as LegacyFS from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { API_URL, api } from '../api/client';

/**
 * Picking, hashing, uploading and opening evidence files (action evidence, document vault).
 * The hash is computed on the device; the server counts a file only when the bytes it
 * receives match that hash. These uploads need a connection (they are not queued offline).
 */
export type Picked = { bytes: Uint8Array<ArrayBuffer>; mime: string; sha256: string; name: string };

/** Accepted types and the size limit (the server enforces both again). */
export const ACCEPTED = { photo: ['image/jpeg', 'image/png'], document: ['application/pdf', 'image/jpeg', 'image/png'] };
export const TYPE_LABEL: Record<string, string> = { 'application/pdf': 'PDF', 'image/jpeg': 'JPEG', 'image/png': 'PNG' };
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
export const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const guessMime = (name: string) => (/\.pdf$/i.test(name) ? 'application/pdf' : /\.png$/i.test(name) ? 'image/png' : /\.jpe?g$/i.test(name) ? 'image/jpeg' : '');
function checkFile(kind: 'photo' | 'document', mime: string, size: number, maxBytes: number) {
  if (!ACCEPTED[kind].includes(mime)) throw new Error(kind === 'photo' ? 'Yalnızca JPEG veya PNG kabul edilir.' : `Bu dosya türü kabul edilmiyor${mime ? ` (${mime})` : ''}. PDF, JPEG ya da PNG seç.`);
  if (size > maxBytes) throw new Error(`Dosya çok büyük (${fmtSize(size)}). En fazla ${fmtSize(maxBytes)} yüklenebilir.`);
}

export const INSECURE_WEB = 'Bu sayfa güvenli bağlantıyla (https) açılmadığı için tarayıcı dosyanın özetini hesaplayamıyor; dosya eklenemez. Uygulamayı https adresinden aç.';

async function hash(bytes: Uint8Array<ArrayBuffer>) {
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}

/** On the web a file input (PDF, JPEG, PNG); on a phone the camera or the photo library. */
export async function pickFile(kind: 'photo' | 'document', maxBytes = DEFAULT_MAX_BYTES): Promise<Picked | null> {
  if (Platform.OS === 'web' && !globalThis.crypto?.subtle) throw new Error(INSECURE_WEB);
  if (Platform.OS === 'web') {
    const file = await new Promise<File | null>(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = kind === 'photo' ? 'image/jpeg,image/png' : 'application/pdf,image/jpeg,image/png';
      input.onchange = () => resolve(input.files?.[0] ?? null);
      input.click();
    });
    if (!file) return null;
    const mime = file.type || guessMime(file.name);
    checkFile(kind, mime, file.size, maxBytes);
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { bytes, mime, sha256: await hash(bytes), name: file.name };
  }
  if (kind === 'document') {
    // Phone: the system file picker (Files / Drive / Downloads), not only the photo library.
    const res = await DocumentPicker.getDocumentAsync({ type: ACCEPTED.document, copyToCacheDirectory: true, multiple: false });
    if (res.canceled) return null;
    const a = res.assets[0]!;
    const mime = a.mimeType || guessMime(a.name);
    checkFile(kind, mime, a.size ?? 0, maxBytes);
    const b64 = await LegacyFS.readAsStringAsync(a.uri, { encoding: LegacyFS.EncodingType.Base64 });
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    checkFile(kind, mime, bytes.length, maxBytes);
    return { bytes, mime, sha256: await hash(bytes), name: a.name };
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, base64: true };
  let res = await ImagePicker.launchCameraAsync(opts);
  if (res.canceled) res = await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled) return null;
  const a = res.assets[0]!;
  const b64 = a.base64 ?? null;
  const mime = a.mimeType ?? 'image/jpeg';
  if (!b64) throw new Error('Dosya okunamadı.');
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  checkFile(kind, mime, bytes.length, maxBytes);
  return { bytes, mime, sha256: await hash(bytes), name: a.fileName ?? 'foto.jpg' };
}

export const fileMeta = (f: Picked) => ({ mime: f.mime, sha256: f.sha256, sizeBytes: f.bytes.length });

export async function uploadBytes(token: string | null, companyId: string, evidenceId: string, f: Picked) {
  return api('PUT', `/companies/${companyId}/evidence/${evidenceId}/content`, { token, bytes: { data: f.bytes, mime: f.mime } });
}

/**
 * Opens (or saves) a stored file. Web: a new tab, or a download with the given name.
 * Phone: downloaded with the session's authorisation into the app cache, then the system
 * share sheet opens it (view, save to Files, send).
 */
export async function openEvidence(token: string | null, companyId: string, evidenceId: string, opts: { download?: boolean; name?: string } = {}) {
  const url = `${API_URL}/companies/${companyId}/evidence/${evidenceId}/content`;
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  if (Platform.OS === 'web') {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(res.status === 404 ? 'Dosyayı görme yetkin yok ya da dosya yok.' : 'Dosya açılamadı.');
    const blobUrl = URL.createObjectURL(await res.blob());
    if (opts.download) {
      const a = document.createElement('a');
      a.href = blobUrl; a.download = opts.name ?? 'belge'; a.click();
    } else {
      // After an awaited fetch some browsers (iOS Safari) block the new tab. Never fail silently: fall back to a download.
      const w = window.open(blobUrl, '_blank');
      if (w) w.opener = null;
      else {
        const a = document.createElement('a');
        a.href = blobUrl; a.download = opts.name ?? 'belge'; a.click();
      }
    }
    return;
  }
  const ext = (opts.name?.match(/\.[a-z0-9]+$/i)?.[0]) ?? '';
  const dest = `${LegacyFS.cacheDirectory}goverhub-${evidenceId}${ext}`;
  const r = await LegacyFS.downloadAsync(url, dest, { headers });
  if (r.status !== 200) throw new Error(r.status === 404 ? 'Dosyayı görme yetkin yok ya da dosya yok.' : 'Dosya indirilemedi.');
  if (!(await Sharing.isAvailableAsync())) throw new Error('Bu cihazda dosya açma/paylaşma kullanılamıyor.');
  await Sharing.shareAsync(r.uri, { mimeType: r.headers['content-type'] ?? r.headers['Content-Type'], dialogTitle: opts.name ?? 'Belge' });
}

/**
 * Fetches a stored file with the session's authorisation and returns a local URI an <Image> can show
 * (web: a blob URL, to be released with `release`; phone: a file in the app cache). Throws a readable message.
 */
export async function fetchEvidenceUri(token: string | null, companyId: string, evidenceId: string): Promise<{ uri: string; mime: string; release: () => void }> {
  const url = `${API_URL}/companies/${companyId}/evidence/${evidenceId}/content`;
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  if (Platform.OS === 'web') {
    let res: Response;
    try { res = await fetch(url, { headers }); } catch { throw new Error('Bağlantı yok; fotoğraf yüklenemedi.'); }
    if (!res.ok) throw new Error(res.status === 404 || res.status === 403 ? 'Dosyayı görme yetkin yok ya da dosya yok.' : 'Fotoğraf yüklenemedi.');
    const blob = await res.blob();
    if (!blob.size) throw new Error('Dosya boş geldi.');
    const uri = URL.createObjectURL(blob);
    return { uri, mime: blob.type, release: () => URL.revokeObjectURL(uri) };
  }
  const dest = `${LegacyFS.cacheDirectory}goverhub-${evidenceId}`;
  let r;
  try { r = await LegacyFS.downloadAsync(url, dest, { headers }); } catch { throw new Error('Bağlantı yok; fotoğraf yüklenemedi.'); }
  if (r.status !== 200) throw new Error(r.status === 404 || r.status === 403 ? 'Dosyayı görme yetkin yok ya da dosya yok.' : 'Fotoğraf yüklenemedi.');
  return { uri: r.uri, mime: r.headers['content-type'] ?? r.headers['Content-Type'] ?? '', release: () => {} };
}

/**
 * Download a file the server builds for this person (e.g. the PDF audit file). On the web the browser
 * saves it; on a phone it is stored in the app's cache and offered to the share sheet (Files, Drive …).
 */
export async function downloadFromApi(token: string | null, path: string, name: string) {
  const url = `${API_URL}${path}`;
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  if (Platform.OS === 'web') {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      let msg = res.status === 404 ? 'Bu şube ya da kayıtlar için yetkin yok.' : res.status === 403 ? 'Bu dosyayı alma yetkin yok.' : 'Dosya hazırlanamadı.';
      try { msg = (await res.json()).error?.message ?? msg; } catch { /* not JSON */ }
      throw new Error(msg);
    }
    const blobUrl = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = blobUrl; a.download = name; a.click();
    return;
  }
  const dest = `${LegacyFS.cacheDirectory}${name}`;
  const r = await LegacyFS.downloadAsync(url, dest, { headers });
  if (r.status !== 200) throw new Error(r.status === 404 ? 'Bu şube ya da kayıtlar için yetkin yok.' : 'Dosya indirilemedi.');
  if (!(await Sharing.isAvailableAsync())) throw new Error('Bu cihazda dosya paylaşma kullanılamıyor.');
  await Sharing.shareAsync(r.uri, { mimeType: 'application/pdf', dialogTitle: name });
}
