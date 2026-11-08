import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { API_URL, api } from '../api/client';

/**
 * Picking, hashing, uploading and opening evidence files (action evidence, document vault).
 * The hash is computed on the device; the server counts a file only when the bytes it
 * receives match that hash. These uploads need a connection (they are not queued offline).
 */
export type Picked = { bytes: Uint8Array<ArrayBuffer>; mime: string; sha256: string; name: string };

export const INSECURE_WEB = 'Bu sayfa güvenli bağlantıyla (https) açılmadığı için tarayıcı dosyanın özetini hesaplayamıyor; dosya eklenemez. Uygulamayı https adresinden aç.';

async function hash(bytes: Uint8Array<ArrayBuffer>) {
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}

/** On the web a file input (PDF, JPEG, PNG); on a phone the camera or the photo library. */
export async function pickFile(kind: 'photo' | 'document'): Promise<Picked | null> {
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
    const mime = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '');
    if (!['image/jpeg', 'image/png', ...(kind === 'document' ? ['application/pdf'] : [])].includes(mime)) {
      throw new Error(kind === 'photo' ? 'Yalnızca JPEG veya PNG kabul edilir.' : 'Yalnızca PDF, JPEG veya PNG kabul edilir.');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { bytes, mime, sha256: await hash(bytes), name: file.name };
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, base64: true };
  let res = await ImagePicker.launchCameraAsync(opts);
  if (res.canceled) res = await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled) return null;
  const a = res.assets[0]!;
  const b64 = a.base64 ?? null;
  const mime = a.mimeType ?? 'image/jpeg';
  if (!b64) throw new Error('Dosya okunamadı.');
  if (!['image/jpeg', 'image/png'].includes(mime)) throw new Error('Yalnızca JPEG veya PNG kabul edilir.');
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return { bytes, mime, sha256: await hash(bytes), name: a.fileName ?? 'foto.jpg' };
}

export const fileMeta = (f: Picked) => ({ mime: f.mime, sha256: f.sha256, sizeBytes: f.bytes.length });

export async function uploadBytes(token: string | null, companyId: string, evidenceId: string, f: Picked) {
  return api('PUT', `/companies/${companyId}/evidence/${evidenceId}/content`, { token, bytes: { data: f.bytes, mime: f.mime } });
}

/** Opens a stored file in a new tab (web). On a phone the file is shown in the web app for now. */
export async function openEvidence(token: string | null, companyId: string, evidenceId: string) {
  const res = await fetch(`${API_URL}/companies/${companyId}/evidence/${evidenceId}/content`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(res.status === 404 ? 'Dosyayı görme yetkin yok ya da dosya yok.' : 'Dosya açılamadı.');
  if (Platform.OS !== 'web') throw new Error('Dosya şimdilik web uygulamasında açılıyor.');
  const url = URL.createObjectURL(await res.blob());
  window.open(url, '_blank', 'noopener');
}
