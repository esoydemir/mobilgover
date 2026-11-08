import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { errorText } from '../../api/client';
import { useSession } from '../../api/session';
import { useApi } from '../../api/useApi';
import { Screen } from '../../components/Screen';
import { ErrorBox, Field, Loading } from '../../components/states';
import { Card, Eyebrow, FilterChip, GhostButton, Pill, PrimaryButton } from '../../components/ui';
import { useUi } from '../../state/app';
import { fmtDateTime } from '../../features/dates';
import { DOC_STATUS, DOC_TYPE, ISSUER_METHOD, STATUS_NOTE, fmtDay } from '../../features/documents';
import { ACCEPTED, TYPE_LABEL, fileMeta, fmtSize, openEvidence, pickFile, uploadBytes, type Picked } from '../../features/files';
import { C, tint, type } from '../../theme';

type Version = { id: string; version: number; valid_from: string | null; valid_until: string | null; notes: string | null; review_status: 'unreviewed' | 'verified' | 'rejected';
  review_notes: string | null; reviewed_at: string | null; reviewed_by_name: string | null; uploaded_by_name: string; uploaded_at: string;
  issuer_check_method: string | null; issuer_check_ref: string | null; issuer_check_notes: string | null; issuer_checked_at: string | null; issuer_checked_by_name: string | null;
  evidence_id: string | null; file_status: string | null; mime: string | null; size_bytes: number | null; declared_sha256: string | null; file_rejection: string | null;
  canReview: boolean; reviewBlockedReason: string | null; canRecordIssuerCheck: boolean; canRetryUpload: boolean };
type DocDetail = { id: string; docType: string; title: string; issuer: string | null; documentNo: string | null; siteId: string | null; siteName: string | null; equipmentName: string | null;
  status: string; expiring: boolean; notYetValid: boolean; currentVersionId: string | null; validFrom: string | null; validUntil: string | null; expiryWarningDays: number;
  maxUploadBytes: number; shares: { id: string; site_id: string; site_name: string }[]; versions: Version[];
  permissions: { write: boolean; review: boolean; share: boolean } };

const isDay = (v: string) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v);
const REVIEW: Record<string, [string, string]> = { unreviewed: ['İNCELENMEDİ', C.warn], verified: ['KURUM İÇİ İNCELENDİ', C.info], rejected: ['REDDEDİLDİ', C.crit] };
const typesText = ACCEPTED.document.map(m => TYPE_LABEL[m]).join(', ');
const fileName = (d: DocDetail, v: Version) => `${d.title} - surum ${v.version}${v.mime === 'application/pdf' ? '.pdf' : v.mime === 'image/png' ? '.png' : '.jpg'}`;

export default function DocumentRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { company, token } = useSession();
  const q = useApi<DocDetail>(company ? `/companies/${company.id}/documents/${id}` : null);
  const d = q.data;
  const [err, setErr] = useState<string | null>(null);
  const open = async (v: Version, download: boolean) => {
    setErr(null);
    try { await openEvidence(token, company!.id, v.evidence_id!, { download, name: fileName(d!, v) }); } catch (e) { setErr((e as Error).message); }
  };
  const st = d ? DOC_STATUS[d.status] ?? DOC_STATUS.no_file! : null;
  return (
    <Screen title="Belge" titleEn="Document" onRefresh={q.reload} refreshing={q.loading}>
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {!d || !st ? <Loading /> : (
        <>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Pill label={st[0]} fg={st[1]} bg={st[2]} />
            {d.expiring ? <Pill label="SÜRESİ YAKLAŞIYOR" fg={C.warn} bg={tint.warn(0.14)} /> : null}
            {d.notYetValid ? <Pill label="HENÜZ YÜRÜRLÜKTE DEĞİL" fg={C.info} bg={tint.info(0.14)} /> : null}
          </View>
          <Text style={type(23, 600, { family: 'outfit', ls: -0.03, lh: 1.15 })}>{d.title}</Text>
          <Text style={type(12.5, 400, { color: C.t2, lh: 1.5 })}>
            {DOC_TYPE[d.docType] ?? d.docType} · {d.equipmentName ? `Ekipman: ${d.equipmentName}` : d.siteName ? `Şube: ${d.siteName}` : 'İşletme geneli'}
            {d.issuer ? ` · ${d.issuer}` : ''}{d.documentNo ? ` · no ${d.documentNo}` : ''}
          </Text>
          <Card style={{ gap: 6 }}>
            <Eyebrow>DURUM VE GEÇERLİLİK</Eyebrow>
            <Text testID="doc-status-note" style={type(12.5, 400, { color: C.t2, lh: 1.5 })}>{STATUS_NOTE[d.status]}</Text>
            {d.currentVersionId ? (
              <Text style={type(13, 500, { lh: 1.5 })}>İncelenen sürüme göre {fmtDay(d.validFrom)} – {fmtDay(d.validUntil)}. Bitişe {d.expiryWarningDays} gün kala ve bitince yöneticilere hatırlatma gider.</Text>
            ) : null}
          </Card>
          {!d.permissions.write && !d.siteId ? <Text style={type(11.5, 400, { color: C.t3 })}>Bu işletme geneli belge şubenle paylaşıldı: yalnız okuyabilirsin.</Text> : null}
          {err ? <ErrorBox message={err} /> : null}
          {d.permissions.share ? <ShareCard d={d} onDone={q.reload} /> : null}
          {d.permissions.write ? <NewVersion docId={d.id} maxBytes={d.maxUploadBytes} onDone={q.reload} /> : null}
          <Eyebrow>SÜRÜMLER</Eyebrow>
          {d.versions.length === 0 ? <Text style={type(12.5, 400, { color: C.t2 })}>Henüz dosya yok.</Text> : null}
          {d.versions.map(v => <VersionRow key={v.id} v={v} d={d} current={v.id === d.currentVersionId} onOpen={open} onDone={q.reload} />)}
        </>
      )}
    </Screen>
  );
}

/** Company-wide document: which sites may read it (read only). */
function ShareCard({ d, onDone }: { d: DocDetail; onDone: () => void }) {
  const { company, call } = useSession();
  const [error, setError] = useState<string | null>(null);
  const sites = company?.sites ?? [];
  if (sites.length === 0) return null;
  const toggle = async (siteId: string, share: boolean) => {
    setError(null);
    try { await call('POST', `/companies/${company!.id}/documents/${d.id}/shares`, { siteId, share }); onDone(); } catch (e) { setError(errorText(e)); }
  };
  return (
    <Card style={{ gap: 8 }}>
      <Eyebrow>ŞUBELERLE PAYLAŞIM (YALNIZ OKUMA)</Eyebrow>
      <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Seçilen şubenin yöneticisi belgeyi görür ve açar; değiştiremez, inceleyemez. Paylaşımı kaldırabilirsin; geçmişte kalır.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
        {sites.map(s => {
          const on = d.shares.some(x => x.site_id === s.id);
          return <FilterChip key={s.id} testID={`doc-share-${s.id}`} label={on ? `✓ ${s.name}` : s.name} px={12} active={on} onPress={() => toggle(s.id, !on)} />;
        })}
      </View>
      {error ? <ErrorBox message={error} /> : null}
    </Card>
  );
}

function NewVersion({ docId, maxBytes, onDone }: { docId: string; maxBytes: number; onDone: () => void }) {
  const { company, token, call } = useSession();
  const { showToast } = useUi();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<Picked | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Registered on the server but the bytes did not arrive: retry the same upload.
  const [pending, setPending] = useState<{ evidenceId: string; version: number } | null>(null);
  if (!open) return <GhostButton testID="doc-version-open" label="Yeni sürüm / dosya ekle" height={42} size={12.5} style={{ alignSelf: 'flex-start' }} onPress={() => setOpen(true)} />;
  const pick = async () => { setError(null); try { const f = await pickFile('document', maxBytes); if (f) { setFile(f); setPending(null); } } catch (e) { setError((e as Error).message); } };
  const finish = (version: number) => {
    showToast(`Sürüm ${version} yüklendi`, 'İnceleme bekliyor; incelenene kadar geçerli sayılmaz.');
    setOpen(false); setFile(null); setFrom(''); setUntil(''); setNotes(''); setPending(null);
    onDone();
  };
  const upload = async (evidenceId: string, version: number) => {
    try { await uploadBytes(token, company!.id, evidenceId, file!); finish(version); }
    catch (e) {
      setPending({ evidenceId, version });
      setError(`Yükleme tamamlanmadı: ${errorText(e) === 'Beklenmeyen bir hata oluştu.' ? (e as Error).message : errorText(e)} Sürüm kaydı duruyor; "Yüklemeyi yeniden dene"ye bas.`);
      onDone();
    }
  };
  const save = async () => {
    setBusy(true); setError(null);
    try {
      if (pending) { await upload(pending.evidenceId, pending.version); return; }
      const r = await call<{ evidenceId: string; version: number }>('POST', `/companies/${company!.id}/documents/${docId}/versions`,
        { validFrom: from || null, validUntil: until || null, notes: notes.trim() || null, file: fileMeta(file!) });
      await upload(r.evidenceId, r.version);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <Card style={{ gap: 10 }}>
      <Eyebrow>YENİ SÜRÜM</Eyebrow>
      <Text testID="doc-file-rules" style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Kabul edilen türler: {typesText}. En fazla {fmtSize(maxBytes)}. {Platform.OS === 'web' ? '' : 'Telefonda dosya seçici açılır (Dosyalar, Drive, İndirilenler).'}</Text>
      <GhostButton testID="doc-file-pick" label={file ? `Seçildi: ${file.name} · ${TYPE_LABEL[file.mime] ?? file.mime} · ${fmtSize(file.bytes.length)}` : 'Dosya seç'} height={40} size={12} style={{ alignSelf: 'flex-start' }} onPress={pick} disabled={busy || !!pending} />
      {!pending ? (
        <>
          <Field label="Geçerlilik başlangıcı (YYYY-AA-GG, isteğe bağlı)" testID="doc-valid-from" value={from} onChangeText={setFrom} placeholder="2026-01-15" />
          <Field label="Geçerlilik sonu (YYYY-AA-GG; süresizse boş bırak)" testID="doc-valid-until" value={until} onChangeText={setUntil} placeholder="2027-01-15" />
          <Field label="Not (isteğe bağlı)" value={notes} onChangeText={setNotes} multiline />
          <Text style={type(11, 400, { color: C.t3, lh: 1.45 })}>Tarihleri belgede yazdığı gibi gir; inceleyen kişi belgeyle karşılaştırıp onaylar ya da düzeltir.</Text>
        </>
      ) : null}
      {error ? <ErrorBox message={error} /> : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <PrimaryButton testID="doc-version-save" label={busy ? 'Yükleniyor…' : pending ? 'Yüklemeyi yeniden dene' : 'Yükle ve incelemeye gönder'} glow={false} height={44} size={12.5} style={{ flex: 1 }}
          disabled={busy || !file || !isDay(from) || !isDay(until)} onPress={save} />
        <GhostButton label="Vazgeç" height={44} size={12.5} onPress={() => { setOpen(false); setPending(null); setError(null); }} />
      </View>
    </Card>
  );
}

/** A version whose file never arrived (e.g. the connection dropped): the uploader picks the same file again. */
function RetryUpload({ v, docTitle, onDone }: { v: Version; docTitle: string; onDone: () => void }) {
  const { company, token } = useSession();
  const { showToast } = useUi();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setError(null); setBusy(true);
    try {
      const f = await pickFile('document');
      if (!f) return;
      if (f.sha256 !== v.declared_sha256) { setError('Seçtiğin dosya bu sürüm için kaydedilen dosya değil. Aynı dosyayı seç ya da yeni sürüm ekle.'); return; }
      await uploadBytes(token, company!.id, v.evidence_id!, f);
      showToast('Dosya yüklendi', `${docTitle} · sürüm ${v.version} incelemeye hazır.`);
      onDone();
    } catch (e) { setError(errorText(e) === 'Beklenmeyen bir hata oluştu.' ? (e as Error).message : errorText(e)); } finally { setBusy(false); }
  };
  return (
    <View style={{ gap: 6 }}>
      <GhostButton testID={`doc-retry-${v.version}`} label={busy ? 'Yükleniyor…' : 'Aynı dosyayı yeniden yükle'} height={34} size={11.5} color={C.warn} border={tint.warn(0.35)} style={{ alignSelf: 'flex-start' }} disabled={busy} onPress={retry} />
      {error ? <ErrorBox message={error} /> : null}
    </View>
  );
}

function VersionRow({ v, d, current, onOpen, onDone }: { v: Version; d: DocDetail; current: boolean; onOpen: (v: Version, download: boolean) => void; onDone: () => void }) {
  const { company, call } = useSession();
  const { showToast } = useUi();
  const [mode, setMode] = useState<'review' | 'issuer' | null>(null);
  const [notes, setNotes] = useState('');
  const [until, setUntil] = useState(v.valid_until ?? '');
  const [method, setMethod] = useState<string>('barcode_query');
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/companies/${company!.id}/documents/${d.id}/versions/${v.id}`;
  const run = async (fn: () => Promise<unknown>, ok: string, sub: string) => {
    setBusy(true); setError(null);
    try { await fn(); showToast(ok, sub); setMode(null); onDone(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const [label, color] = REVIEW[v.review_status]!;
  return (
    <View testID={`doc-version-${v.version}`} style={{ borderWidth: 1, borderColor: current ? tint.lime(0.35) : v.canReview ? tint.warn(0.35) : C.bd, borderRadius: 16, padding: 12, gap: 5 }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Text style={[type(12.5, 600), { flex: 1 }]}>Sürüm {v.version}{current ? ' · esas alınan sürüm' : ''}</Text>
        <Text style={type(10, 700, { ls: 0.08, color: v.issuer_check_method ? C.lime : color })}>
          {v.file_status !== 'stored' && v.review_status === 'unreviewed' ? (v.file_status === 'rejected' ? 'DOSYA REDDEDİLDİ' : 'DOSYA YÜKLENMEDİ') : v.issuer_check_method ? 'KURUMDAN DOĞRULANDI' : label}
        </Text>
      </View>
      <Text style={type(11.5, 400, { color: C.t3 })}>{fmtDay(v.valid_from)} – {fmtDay(v.valid_until)} · {v.uploaded_by_name}, {fmtDateTime(v.uploaded_at)}
        {v.mime ? ` · ${TYPE_LABEL[v.mime] ?? v.mime}` : ''}{v.size_bytes ? ` · ${fmtSize(Number(v.size_bytes))}` : ''}</Text>
      {v.notes ? <Text style={type(12, 400, { color: C.t2 })}>{v.notes}</Text> : null}
      {v.file_rejection ? <Text style={type(12, 400, { color: C.crit })}>Dosya reddedildi: {v.file_rejection}</Text> : null}
      {v.review_notes ? <Text style={type(12, 400, { color: v.review_status === 'rejected' ? C.crit : C.t2, lh: 1.45 })}>Kurum içi inceleme: {v.review_notes} · {v.reviewed_by_name}</Text> : null}
      {v.issuer_check_method ? (
        <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>Düzenleyen kurumla doğrulama: {ISSUER_METHOD[v.issuer_check_method]} · ref. {v.issuer_check_ref}
          {v.issuer_check_notes ? ` · ${v.issuer_check_notes}` : ''} · kaydeden {v.issuer_checked_by_name}</Text>
      ) : null}
      {v.reviewBlockedReason ? <Text style={type(11.5, 400, { color: C.t3 })}>{v.reviewBlockedReason}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap', marginTop: 3 }}>
        {v.evidence_id && v.file_status === 'stored' ? <GhostButton testID={`doc-file-open-${v.version}`} label="Aç" height={34} size={11.5} onPress={() => onOpen(v, false)} /> : null}
        {v.evidence_id && v.file_status === 'stored' ? <GhostButton testID={`doc-file-download-${v.version}`} label={Platform.OS === 'web' ? 'İndir' : 'Kaydet / paylaş'} height={34} size={11.5} onPress={() => onOpen(v, true)} /> : null}
        {v.canReview && !mode ? <GhostButton testID={`doc-review-open-${v.version}`} label="Kurum içi incele" height={34} size={11.5} color={C.lime} border={tint.lime(0.35)} onPress={() => setMode('review')} /> : null}
        {v.canRecordIssuerCheck && !mode ? <GhostButton testID={`doc-issuer-open-${v.version}`} label="Kurum doğrulamasını kaydet" height={34} size={11.5} onPress={() => setMode('issuer')} /> : null}
      </View>
      {v.canRetryUpload ? <RetryUpload v={v} docTitle={d.title} onDone={onDone} /> : null}
      {mode === 'review' ? (
        <View style={{ gap: 8, marginTop: 4 }}>
          <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Kurum içi inceleme: belgeyi aslıyla karşılaştır. Bu, düzenleyen kurumun doğrulaması değildir.</Text>
          <Field label="Belgedeki geçerlilik sonu (gerekirse düzelt; süresizse boş)" testID={`doc-review-until-${v.version}`} value={until} onChangeText={setUntil} />
          <Field label="Neyi kontrol ettin?" testID={`doc-review-notes-${v.version}`} value={notes} onChangeText={setNotes} multiline placeholder="ör. Seri no ve tarih belgeyle aynı." />
          {error ? <ErrorBox message={error} /> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <PrimaryButton testID={`doc-review-ok-${v.version}`} label={busy ? 'Kaydediliyor…' : 'İncelendi'} glow={false} height={40} size={12.5} style={{ flex: 1 }} disabled={busy || notes.trim().length < 5 || !isDay(until)}
              onPress={() => run(() => call('POST', `${base}/review`, { decision: 'verified', notes: notes.trim(), validUntil: until || null }), 'Kurum içi incelendi', 'Resmî doğrulama değildir; kurumla doğruladıysan ayrıca kaydet.')} />
            <GhostButton testID={`doc-review-reject-${v.version}`} label="Reddet" height={40} size={12.5} color={C.crit} border={tint.crit(0.3)} disabled={busy || notes.trim().length < 5}
              onPress={() => run(() => call('POST', `${base}/review`, { decision: 'rejected', notes: notes.trim() }), 'Belge reddedildi', 'Yükleyene bildirildi.')} />
            <GhostButton label="Vazgeç" height={40} size={12.5} onPress={() => setMode(null)} />
          </View>
        </View>
      ) : null}
      {mode === 'issuer' ? (
        <View style={{ gap: 8, marginTop: 4 }}>
          <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Belgeyi düzenleyen kurumla nasıl doğruladığını kaydet. Uygulama kurumu kendisi sorgulamaz; bu kayıt yöntem ve referansla senin beyanındır.</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
            {Object.entries(ISSUER_METHOD).map(([k, l]) => <FilterChip key={k} testID={`doc-issuer-method-${k}`} label={l} px={12} active={method === k} onPress={() => setMethod(k)} />)}
          </View>
          <Field label="Referans (barkod no, yazı tarihi ve sayısı vb.)" testID={`doc-issuer-ref-${v.version}`} value={ref} onChangeText={setRef} />
          <Field label="Not (isteğe bağlı)" value={notes} onChangeText={setNotes} multiline />
          {error ? <ErrorBox message={error} /> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <PrimaryButton testID={`doc-issuer-save-${v.version}`} label={busy ? 'Kaydediliyor…' : 'Kaydet'} glow={false} height={40} size={12.5} style={{ flex: 1 }} disabled={busy || ref.trim().length < 3}
              onPress={() => run(() => call('POST', `${base}/issuer-check`, { method, reference: ref.trim(), notes: notes.trim() || null }), 'Kurum doğrulaması kaydedildi', 'Durum: düzenleyen kurumdan doğrulandı.')} />
            <GhostButton label="Vazgeç" height={40} size={12.5} onPress={() => setMode(null)} />
          </View>
        </View>
      ) : null}
    </View>
  );
}
