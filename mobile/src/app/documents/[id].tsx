import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../../api/client';
import { useSession } from '../../api/session';
import { useApi } from '../../api/useApi';
import { Screen } from '../../components/Screen';
import { ErrorBox, Field, Loading } from '../../components/states';
import { Card, Eyebrow, GhostButton, Pill, PrimaryButton } from '../../components/ui';
import { useUi } from '../../state/app';
import { fmtDateTime } from '../../features/dates';
import { DOC_STATUS, DOC_TYPE, fmtDay } from '../../features/documents';
import { fileMeta, openEvidence, pickFile, uploadBytes, type Picked } from '../../features/files';
import { C, tint, type } from '../../theme';

type Version = { id: string; version: number; valid_from: string | null; valid_until: string | null; notes: string | null; review_status: 'unreviewed' | 'verified' | 'rejected';
  review_notes: string | null; reviewed_at: string | null; reviewed_by_name: string | null; uploaded_by_name: string; uploaded_at: string;
  evidence_id: string | null; file_status: string | null; canReview: boolean; reviewBlockedReason: string | null };
type DocDetail = { id: string; docType: string; title: string; issuer: string | null; documentNo: string | null; siteName: string | null; equipmentName: string | null;
  status: string; currentVersionId: string | null; validFrom: string | null; validUntil: string | null; expiryWarningDays: number; versions: Version[];
  permissions: { write: boolean; review: boolean } };

const isDay = (v: string) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v);
const REVIEW: Record<string, [string, string]> = { unreviewed: ['İNCELENMEDİ', C.warn], verified: ['İNCELENDİ', C.lime], rejected: ['REDDEDİLDİ', C.crit] };

export default function DocumentRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { company, token } = useSession();
  const q = useApi<DocDetail>(company ? `/companies/${company.id}/documents/${id}` : null);
  const d = q.data;
  const [err, setErr] = useState<string | null>(null);
  const open = async (evId: string) => { setErr(null); try { await openEvidence(token, company!.id, evId); } catch (e) { setErr((e as Error).message); } };
  return (
    <Screen title="Belge" titleEn="Document" onRefresh={q.reload} refreshing={q.loading}>
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {!d ? <Loading /> : (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pill label={(DOC_STATUS[d.status] ?? DOC_STATUS.no_file!)[0]} fg={(DOC_STATUS[d.status] ?? DOC_STATUS.no_file!)[1]} bg={(DOC_STATUS[d.status] ?? DOC_STATUS.no_file!)[2]} />
          </View>
          <Text style={type(23, 600, { family: 'outfit', ls: -0.03, lh: 1.15 })}>{d.title}</Text>
          <Text style={type(12.5, 400, { color: C.t2, lh: 1.5 })}>
            {DOC_TYPE[d.docType] ?? d.docType} · {d.equipmentName ? `Ekipman: ${d.equipmentName}` : d.siteName ? `Şube: ${d.siteName}` : 'İşletme geneli'}
            {d.issuer ? ` · ${d.issuer}` : ''}{d.documentNo ? ` · no ${d.documentNo}` : ''}
          </Text>
          <Card style={{ gap: 6 }}>
            <Eyebrow>GEÇERLİLİK</Eyebrow>
            {d.currentVersionId ? (
              <Text style={type(13, 500, { lh: 1.5 })}>İncelenmiş sürüme göre {fmtDay(d.validFrom)} – {fmtDay(d.validUntil)}. Süre bitimine {d.expiryWarningDays} gün kala ve bitince yöneticilere hatırlatma gider.</Text>
            ) : (
              <Text style={type(12.5, 400, { color: C.warn, lh: 1.5 })}>İncelenmiş bir sürüm yok; bu belge geçerli sayılmaz. Yüklenmiş olması geçerli olduğu anlamına gelmez.</Text>
            )}
          </Card>
          {err ? <ErrorBox message={err} /> : null}
          {d.permissions.write ? <NewVersion docId={d.id} onDone={q.reload} /> : null}
          <Eyebrow>SÜRÜMLER</Eyebrow>
          {d.versions.length === 0 ? <Text style={type(12.5, 400, { color: C.t2 })}>Henüz dosya yok.</Text> : null}
          {d.versions.map(v => <VersionRow key={v.id} v={v} docId={d.id} current={v.id === d.currentVersionId} onOpen={open} onDone={q.reload} />)}
        </>
      )}
    </Screen>
  );
}

function NewVersion({ docId, onDone }: { docId: string; onDone: () => void }) {
  const { company, token, call } = useSession();
  const { showToast } = useUi();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<Picked | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return <GhostButton testID="doc-version-open" label="Yeni sürüm / dosya ekle" height={42} size={12.5} style={{ alignSelf: 'flex-start' }} onPress={() => setOpen(true)} />;
  const pick = async () => { setError(null); try { const f = await pickFile('document'); if (f) setFile(f); } catch (e) { setError((e as Error).message); } };
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = await call<{ evidenceId: string; version: number }>('POST', `/companies/${company!.id}/documents/${docId}/versions`,
        { validFrom: from || null, validUntil: until || null, notes: notes.trim() || null, file: fileMeta(file!) });
      await uploadBytes(token, company!.id, r.evidenceId, file!);
      showToast(`Sürüm ${r.version} yüklendi`, 'İnceleme bekliyor; incelenene kadar geçerli sayılmaz.');
      setOpen(false); setFile(null); setFrom(''); setUntil(''); setNotes('');
      onDone();
    } catch (e) { setError(errorText(e) === 'Beklenmeyen bir hata oluştu.' ? (e as Error).message : errorText(e)); onDone(); } finally { setBusy(false); }
  };
  return (
    <Card style={{ gap: 10 }}>
      <Eyebrow>YENİ SÜRÜM</Eyebrow>
      <GhostButton testID="doc-file-pick" label={file ? `Seçildi: ${file.name}` : 'Dosya seç (PDF, JPEG, PNG)'} height={40} size={12} style={{ alignSelf: 'flex-start' }} onPress={pick} />
      <Field label="Geçerlilik başlangıcı (YYYY-AA-GG, isteğe bağlı)" testID="doc-valid-from" value={from} onChangeText={setFrom} placeholder="2026-01-15" />
      <Field label="Geçerlilik sonu (YYYY-AA-GG; süresizse boş bırak)" testID="doc-valid-until" value={until} onChangeText={setUntil} placeholder="2027-01-15" />
      <Field label="Not (isteğe bağlı)" value={notes} onChangeText={setNotes} multiline />
      <Text style={type(11, 400, { color: C.t3, lh: 1.45 })}>Tarihleri belgede yazdığı gibi gir; inceleyen kişi belgeyle karşılaştırıp onaylar ya da düzeltir.</Text>
      {error ? <ErrorBox message={error} /> : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <PrimaryButton testID="doc-version-save" label={busy ? 'Yükleniyor…' : 'Yükle ve incelemeye gönder'} glow={false} height={44} size={12.5} style={{ flex: 1 }}
          disabled={busy || !file || !isDay(from) || !isDay(until)} onPress={save} />
        <GhostButton label="Vazgeç" height={44} size={12.5} onPress={() => setOpen(false)} />
      </View>
    </Card>
  );
}

function VersionRow({ v, docId, current, onOpen, onDone }: { v: Version; docId: string; current: boolean; onOpen: (id: string) => void; onDone: () => void }) {
  const { company, call } = useSession();
  const { showToast } = useUi();
  const [mode, setMode] = useState(false);
  const [notes, setNotes] = useState('');
  const [until, setUntil] = useState(v.valid_until ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const review = async (decision: 'verified' | 'rejected') => {
    setBusy(true); setError(null);
    try {
      await call('POST', `/companies/${company!.id}/documents/${docId}/versions/${v.id}/review`,
        { decision, notes: notes.trim(), ...(decision === 'verified' ? { validUntil: until || null } : {}) });
      showToast(decision === 'verified' ? 'Belge doğrulandı' : 'Belge reddedildi', decision === 'verified' ? 'Geçerlilik incelenen tarihlere göre hesaplanır.' : 'Yükleyene bildirildi.');
      onDone();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const [label, color] = REVIEW[v.review_status]!;
  return (
    <View testID={`doc-version-${v.version}`} style={{ borderWidth: 1, borderColor: current ? tint.lime(0.35) : v.canReview ? tint.warn(0.35) : C.bd, borderRadius: 16, padding: 12, gap: 5 }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Text style={[type(12.5, 600), { flex: 1 }]}>Sürüm {v.version}{current ? ' · geçerli sürüm' : ''}</Text>
        <Text style={type(10, 700, { ls: 0.08, color })}>{v.file_status !== 'stored' && v.review_status === 'unreviewed' ? 'DOSYA YÜKLENMEDİ' : label}</Text>
      </View>
      <Text style={type(11.5, 400, { color: C.t3 })}>{fmtDay(v.valid_from)} – {fmtDay(v.valid_until)} · {v.uploaded_by_name}, {fmtDateTime(v.uploaded_at)}</Text>
      {v.notes ? <Text style={type(12, 400, { color: C.t2 })}>{v.notes}</Text> : null}
      {v.review_notes ? <Text style={type(12, 400, { color: v.review_status === 'rejected' ? C.crit : C.t2, lh: 1.45 })}>İnceleme: {v.review_notes} · {v.reviewed_by_name}</Text> : null}
      {v.reviewBlockedReason ? <Text style={type(11.5, 400, { color: C.t3 })}>{v.reviewBlockedReason}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap', marginTop: 3 }}>
        {v.evidence_id && v.file_status === 'stored' ? <GhostButton testID={`doc-file-open-${v.version}`} label="Dosyayı aç" height={34} size={11.5} onPress={() => onOpen(v.evidence_id!)} /> : null}
        {v.canReview && !mode ? <GhostButton testID={`doc-review-open-${v.version}`} label="İncele" height={34} size={11.5} color={C.lime} border={tint.lime(0.35)} onPress={() => setMode(true)} /> : null}
      </View>
      {mode ? (
        <View style={{ gap: 8, marginTop: 4 }}>
          <Field label="Belgedeki geçerlilik sonu (gerekirse düzelt; süresizse boş)" testID={`doc-review-until-${v.version}`} value={until} onChangeText={setUntil} />
          <Field label="Neyi kontrol ettin?" testID={`doc-review-notes-${v.version}`} value={notes} onChangeText={setNotes} multiline placeholder="ör. Seri no ve tarih belgeyle aynı." />
          {error ? <ErrorBox message={error} /> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <PrimaryButton testID={`doc-review-ok-${v.version}`} label={busy ? 'Kaydediliyor…' : 'Doğrula'} glow={false} height={40} size={12.5} style={{ flex: 1 }} disabled={busy || notes.trim().length < 5 || !isDay(until)} onPress={() => review('verified')} />
            <GhostButton testID={`doc-review-reject-${v.version}`} label="Reddet" height={40} size={12.5} color={C.crit} border={tint.crit(0.3)} disabled={busy || notes.trim().length < 5} onPress={() => review('rejected')} />
            <GhostButton label="Vazgeç" height={40} size={12.5} onPress={() => setMode(false)} />
          </View>
        </View>
      ) : null}
    </View>
  );
}
