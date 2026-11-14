import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { useQueue, type Op } from '../../api/queue';
import { useSession } from '../../api/session';
import type { Requirement, TaskDetail, TaskRow } from '../../api/types';
import { useApi } from '../../api/useApi';
import { CameraIcon, WarnIcon } from '../../components/Icons';
import { Screen } from '../../components/Screen';
import { ErrorBox, ExampleBadge, Field, Loading, StaleNote } from '../../components/states';
import { Card, Chevron, Eyebrow, GhostButton, PrimaryButton, Rise, SevPill, Tap } from '../../components/ui';
import { AssignCard } from '../../features/AssignCard';
import { fmtDateTime } from '../../features/dates';
import { bucketTasks, taskWindowPath } from '../../features/work';
import { useUi } from '../../state/app';
import { C, tint, type } from '../../theme';

type Instrument = { id: string; type: string; name: string; calibrated_until: string | null };

const OP_TEXT: Record<Op['status'], [string, string]> = {
  pending: ['cihazda · gönderilecek', C.warn],
  syncing: ['gönderiliyor', C.info],
  failed: ['gönderilemedi', C.crit],
  conflict: ['çakışma', C.crit],
};

const INSECURE_WEB = 'Bu sayfa güvenli bağlantıyla (https) açılmadığı için tarayıcı fotoğrafın özetini hesaplayamıyor; fotoğraf eklenemez. Uygulamayı https adresinden aç.';

export default function TaskDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { company, siteId, role } = useSession();
  const { ops, enqueue } = useQueue();
  const { showToast } = useUi();
  const base = `/companies/${company?.id}`;
  const q = useApi<TaskDetail>(company ? `${base}/tasks/${id}` : null);
  const instruments = useApi<Instrument[]>(company && siteId && role !== 'staff' ? `${base}/sites/${siteId}/equipment` : null);
  // History of the same check (same title and unit) in the shared task window: done / nonconforming / late.
  const windowed = useApi<TaskRow[]>(company && siteId ? taskWindowPath(base, siteId) : null);
  const t = q.data;
  const local = ops.filter(o => o.taskId === id);
  const completing = local.find(o => o.path.endsWith('/complete'));

  if (!t) {
    return (
      <Screen title="Görev" titleEn="Task">
        {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : <Loading />}
      </Screen>
    );
  }

  const open = t.status === 'open' && !completing;
  const add = (label: string, path: string, body: unknown, file?: Op['file']) => {
    enqueue({ companyId: company!.id, taskId: id, label: `${t.title}: ${label}`, path, body, file });
    showToast('Kaydedildi', 'Cihazda tutuluyor; bağlantı varsa hemen gönderilir.');
  };
  // Allow completing once the server says evidence is complete, or once local items wait to be sent.
  const canComplete = open && (t.progress.complete || local.length > 0);

  return (
    <Screen title="Görev" titleEn="Task detail" gap={13} onRefresh={q.reload} refreshing={q.loading}>
      {q.stale ? <StaleNote /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <SevPill sev={t.severity === 'critical' ? 'crit' : t.severity === 'major' ? 'imp' : 'low'} big />
        <Text style={type(11.5, 400, { color: C.t3 })}>Son tarih {fmtDateTime(t.dueAt)}</Text>
        {t.rule.isExample ? <ExampleBadge /> : null}
        {t.rule.kind === 'good_practice' ? <ExampleBadge label="İYİ UYGULAMA" /> : null}
      </View>
      <Text style={type(27, 600, { family: 'outfit', ls: -0.035, lh: 1.1 })}>{t.title}</Text>
      {t.equipment ? <Text style={type(13, 600, { color: C.t2 })}>{t.equipment.name}</Text> : null}
      <Text style={type(14.5, 400, { lh: 1.5, color: C.t2 })}>{t.instructions}</Text>

      <Tap onPress={() => router.push(`/obligation/${t.obligationId}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: C.bd, borderRadius: 22, backgroundColor: C.card, paddingVertical: 14, paddingHorizontal: 16 }}>
        <View style={{ width: 26, height: 26, borderRadius: 999, backgroundColor: tint.lime(0.14), alignItems: 'center', justifyContent: 'center' }}>
          <Text style={type(13, 700, { color: C.lime })}>?</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={type(13.5, 600)}>Bunu neden yapmam gerekiyor?</Text>
          <Text style={[type(11.5, 400, { color: C.t3 }), { marginTop: 2 }]}>Kural sürümü {t.rule.version} · eşleşen işletme bilgileri</Text>
        </View>
        <Chevron size={14} />
      </Tap>

      <TaskWhy t={t} role={role} />

      {windowed.data ? (() => {
        const same = bucketTasks(windowed.data).all.filter(x => x.id !== t.id && x.title === t.title && (x.equipment_name ?? null) === (t.equipment?.name ?? null) && new Date(x.due_at) <= new Date());
        const bad = same.filter(x => x.outcome === 'nonconforming').length;
        const late = same.filter(x => x.status === 'missed' || (x.status === 'open' && new Date(x.due_at) < new Date())).length;
        return (
          <Card radius={22} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 6 }}>
            <Eyebrow>GEÇMİŞ · SON 14 GÜN</Eyebrow>
            <Text testID="task-history" style={type(12.5, 500, { color: bad || late ? C.warn : C.t2, lh: 1.45 })}>
              {same.length === 0 ? 'Bu kontrol için önceki kayıt yok.' : `${same.length} önceki kayıt · ${bad} uygunsuz · ${late} gecikmiş/kaçırılmış${bad >= 2 ? ' · tekrar eden uygunsuzluk' : ''}`}
            </Text>
          </Card>
        );
      })() : null}

      {t.status === 'done' && (
        <Card border={t.outcome === 'nonconforming' ? tint.crit(0.35) : tint.lime(0.3)}>
          <Text testID="task-outcome" style={type(15, 700, { color: t.outcome === 'nonconforming' ? C.crit : C.lime })}>
            {t.outcome === 'nonconforming' ? 'Yapıldı · sonuç uygunsuz' : 'Yapıldı · sonuç uygun'}
          </Text>
          {t.reviewFlag ? <Text style={[type(12, 400, { color: C.warn }), { marginTop: 6 }]}>İnceleme gerekiyor: kural sürümü değişti ({t.reviewFlag}).</Text> : null}
          {t.nonconformity ? <PrimaryButton testID="open-ncr" label="Uygunsuzluğu aç" height={44} size={13.5} style={{ marginTop: 12 }} onPress={() => router.push(`/ncr/${t.nonconformity!.id}`)} /> : null}
        </Card>
      )}
      {t.status === 'cancelled' || t.status === 'missed' ? <ErrorBox message={t.status === 'cancelled' ? `Bu görev iptal edildi${t.statusReason ? `: ${t.statusReason}` : '.'}` : 'Bu görevin süresi geçti.'} /> : null}

      {role !== 'staff' && siteId ? <AssignCard key={`${t.assignee?.id}-${t.seriesResponsible?.id}`} t={t} siteId={siteId} onChanged={q.reload} /> : null}

      {t.emergencyInstruction && (open || t.outcome === 'nonconforming') ? (
        <View style={{ borderWidth: 1, borderColor: tint.crit(0.3), backgroundColor: tint.crit(0.06), borderRadius: 18, padding: 14, gap: 6 }}>
          <Text style={type(10, 700, { ls: 0.1, color: C.crit })}>LİMİT DIŞI SONUÇTA · ONAYLI ACİL TALİMAT</Text>
          <Text style={type(13, 500, { lh: 1.5 })}>{t.emergencyInstruction}</Text>
        </View>
      ) : null}

      {open && t.requirements.map((r, i) => (
        <RequirementCard key={i} r={r} t={t} instruments={(instruments.data ?? []).filter(x => x.type === 'thermometer')} role={role} onAdd={add} base={base} />
      ))}

      {t.relatedTraining?.length ? (
        <Card radius={22} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 8 }}>
          <Eyebrow>İLGİLİ EĞİTİMLER</Eyebrow>
          {t.relatedTraining.map(c => (
            <Text key={c.id} testID={`task-training-${c.id}`} onPress={() => router.push(`/training/${c.id}`)} style={type(12.5, 500, { color: C.info, lh: 1.45 })}>
              {c.title}{c.minutes ? ` · ${c.minutes} dk` : ''}{c.is_example ? ' · ÖRNEK İÇERİK' : ' · işletme içi'}
            </Text>
          ))}
          <Text style={type(11, 400, { color: C.t3 })}>Okumak isteğe bağlıdır; yöneticin ayrıca atayabilir.</Text>
        </Card>
      ) : null}

      {t.relatedDocuments?.length ? (
        <Card radius={22} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 8 }}>
          <Eyebrow>İLGİLİ BELGELER</Eyebrow>
          {t.relatedDocuments.map(d => (
            <Text key={d.id} testID={`task-doc-${d.id}`} onPress={() => router.push(`/documents/${d.id}`)} style={type(12.5, 500, { color: C.info, lh: 1.45 })}>{d.title} · {d.purpose}</Text>
          ))}
        </Card>
      ) : null}

      {(t.measurements.length > 0 || t.evidence.length > 0) && (
        <Card radius={22} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 8 }}>
          <Eyebrow>SUNUCUDAKİ KAYITLAR</Eyebrow>
          {t.measurements.map(m => (
            <Text key={m.id} style={type(12.5, 500, { color: m.within_limit ? C.t1 : C.crit })}>
              Ölçüm {m.value} {m.unit} · {m.within_limit ? 'limit içinde' : 'LİMİT DIŞI'} · ölçüm {fmtDateTime(m.measured_at)} · kayıt {fmtDateTime(m.recorded_at)} · kalibrasyon: {m.calibration_status === 'valid' ? 'geçerli' : m.calibration_status === 'expired' ? 'süresi dolmuş' : 'bilinmiyor'}
            </Text>
          ))}
          {t.evidence.map(e => (
            <Text key={e.id} style={type(12.5, 500, { color: e.status === 'rejected' ? C.crit : e.status === 'pending_upload' ? C.warn : C.t1 })}>
              {labelOf(e.kind)} · {e.status === 'stored' ? 'saklandı' : e.status === 'pending_upload' ? 'yükleme tamamlanmadı' : `reddedildi: ${e.rejection_reason}`}
            </Text>
          ))}
        </Card>
      )}

      {local.length > 0 && (
        <Card radius={22} border={tint.warn(0.3)} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 8 }}>
          <Eyebrow color={C.warn}>CİHAZDA BEKLEYEN KAYITLAR</Eyebrow>
          {local.map(o => (
            <View key={o.id} testID="local-op" style={{ gap: 2 }}>
              <Text style={type(12.5, 600)}>{o.label.replace(`${t.title}: `, '')}</Text>
              <Text style={type(11.5, 500, { color: OP_TEXT[o.status][1] })}>{OP_TEXT[o.status][0]}{o.error ? ` · ${o.error}` : ''}</Text>
            </View>
          ))}
          <GhostButton label="Eşitleme ekranı" height={36} size={12} onPress={() => router.push('/sync')} style={{ alignSelf: 'flex-start' }} />
        </Card>
      )}

      {open && t.progress.missing.length > 0 && local.length === 0 && (
        <Text style={type(12, 400, { lh: 1.5, color: C.t3 })}>Eksik kanıt: {t.progress.missing.join(' · ')}</Text>
      )}
      {open ? (
        <PrimaryButton testID="task-complete" label={canComplete ? 'Görevi tamamla' : 'Kanıt bekleniyor'} disabled={!canComplete}
          onPress={() => add('tamamlama', `${base}/tasks/${id}/complete`, { clientCompletedAt: new Date().toISOString() })} />
      ) : completing ? (
        <Text style={[type(12.5, 600, { color: C.warn }), { textAlign: 'center' }]}>Tamamlama cihazda; sunucuya ulaşınca sonuç burada görünür.</Text>
      ) : null}
      {open ? <Text style={[type(11.5, 400, { color: C.t3 }), { textAlign: 'center' }]}>Zorunlu kanıt eksikse sunucu görevi kapatmaz.</Text> : null}
    </Screen>
  );
}

const REQ_TEXT = (r: Requirement) => r.kind === 'measurement' ? `${r.quantity === 'temperature' ? 'Sıcaklık' : r.quantity} ölçümü gir (${r.unit})`
  : r.kind === 'photo' ? `En az ${r.min} fotoğraf ekle` : r.kind === 'document' ? `En az ${r.min} belge ekle`
  : r.kind === 'checklist' ? `Kontrol listesini yanıtla (${r.items.length} madde)` : r.kind === 'note' ? 'Açıklama yaz' : 'Yetkili onayı al';
const SEVERITY_RISK = { critical: "Kritik kontrol: süresi geçerse Risk Merkezi'nde kritik kalem olur ve denetimde kayıt eksikliği olarak görülebilir.",
  major: "Önemli kontrol: süresi geçerse gecikmiş kontrol olarak Risk Merkezi'ne düşer.", minor: 'İyileştirme kontrolü: süresi geçerse gecikmiş olarak görünür.' } as const;

/** Why the task exists, its legal basis, dates, who is responsible, what happens if it is not done, what to do and which services were asked for. */
function TaskWhy({ t, role }: { t: TaskDetail; role: string | null }) {
  const manager = role === 'owner' || role === 'hq_manager' || role === 'site_manager';
  const hasLimit = t.requirements.some(r => r.kind === 'measurement');
  return (
    <>
      <Card radius={22} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 6 }}>
        <Eyebrow>NEDEN GEREKLİ</Eyebrow>
        <Text testID="task-why" style={type(13, 600, { lh: 1.4 })}>{t.rule.title ?? t.title}</Text>
        {t.rule.summary ? <Text style={type(12.5, 400, { color: C.t2, lh: 1.5 })}>{t.rule.summary}</Text> : null}
        <Text testID="task-legal" style={type(11.5, 500, { color: t.legalBasis?.length ? C.t2 : C.warn, lh: 1.45 })}>
          {t.legalBasis?.length ? t.legalBasis.map(p => `${p.source_title}${p.issuer ? ` (${p.issuer})` : ''} · ${p.ref}${p.is_example ? ' · ÖRNEK KAYNAK' : ''}`).join(' · ')
            : 'Doğrulanmış yasal dayanak kaydı yok (örnek kural); bu görev yasal zorunluluk olarak sunulmaz.'}
        </Text>
      </Card>
      <Card radius={22} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 5 }}>
        <Eyebrow>TARİHLER VE SORUMLU</Eyebrow>
        <Text testID="task-dates" style={type(12.5, 500, { color: C.t2, lh: 1.55 })}>
          {`Son tamamlanma: ${t.lastCompletedAt ? fmtDateTime(t.lastCompletedAt) : 'henüz tamamlanmadı'}
Bu kontrolün son tarihi: ${fmtDateTime(t.dueAt)}
Sonraki kontrol: ${t.nextDueAt ? fmtDateTime(t.nextDueAt) : 'planlanmış sonraki yok'}`}
        </Text>
        <Text testID="task-owner" style={type(12.5, 600, { color: t.assignee ? C.t1 : C.warn })}>{t.assignee ? `Sorumlu: ${t.assignee.name ?? 'atanan kişi'}` : `Sorumlu atanmadı${t.seriesResponsible ? ` · seri sorumlusu: ${t.seriesResponsible.name}` : ''}`}</Text>
      </Card>
      <Card radius={22} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 5 }}>
        <Eyebrow>YAPILACAKLAR</Eyebrow>
        {t.requirements.map((r, i) => <Text key={i} style={type(12.5, 500, { color: C.t2, lh: 1.45 })}>{i + 1}. {REQ_TEXT(r)}</Text>)}
        <Text style={type(12.5, 500, { color: C.t2, lh: 1.45 })}>{t.requirements.length + 1}. Görevi tamamla; kanıt eksikse sunucu kapatmaz.</Text>
      </Card>
      <Card radius={22} border={tint.warn(0.25)} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 5 }}>
        <Eyebrow color={C.warn}>TAMAMLANMAZSA</Eyebrow>
        <Text testID="task-risk" style={type(12.5, 500, { color: C.t2, lh: 1.5 })}>{SEVERITY_RISK[t.severity]}{hasLimit ? ' Ölçüm limit dışı çıkarsa uygunsuzluk açılır ve takip gerekir.' : ''}</Text>
        <Text style={type(11.5, 500, { color: C.t3 })}>Olası ceza tutarı: modellenmedi (doğrulanmış ceza tablosu yok).</Text>
      </Card>
      {manager || (t.services?.length ?? 0) > 0 ? (
        <Card radius={22} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 8 }}>
          <Eyebrow>SERVİS</Eyebrow>
          {(t.services ?? []).length === 0 ? <Text style={type(12.5, 400, { color: C.t2, lh: 1.45 })}>Bu görev için servis talebi yok.</Text> : null}
          {(t.services ?? []).map(sv => (
            <Tap key={sv.id} testID={`task-service-${sv.id}`} onPress={() => router.push(`/service/${sv.id}`)}>
              <Text style={type(12.5, 600, { color: C.info })}>{sv.title} · {({ open: 'teklif bekliyor', awarded: 'iş verildi', completed: 'tamamlandı', cancelled: 'iptal' } as Record<string, string>)[sv.status] ?? sv.status} ›</Text>
            </Tap>
          ))}
          {manager && t.status === 'open' ? <GhostButton testID="task-find-service" label="Servis bul" height={40} size={12.5} color={C.lime} border={tint.lime(0.35)}
            onPress={() => router.push(`/service/new?taskId=${t.id}&title=${encodeURIComponent(`${t.title}${t.equipment ? ` · ${t.equipment.name}` : ''}`)}` as never)} /> : null}
        </Card>
      ) : null}
    </>
  );
}

const labelOf = (k: string) => ({ photo: 'Fotoğraf', document: 'Belge', note: 'Not', checklist: 'Kontrol listesi', approval: 'Onay', device_record: 'Cihaz kaydı' } as Record<string, string>)[k] ?? k;

function RequirementCard({ r, t, instruments, role, onAdd, base }: {
  r: Requirement; t: TaskDetail; instruments: Instrument[]; role: string | null; base: string;
  onAdd: (label: string, path: string, body: unknown, file?: Op['file']) => void;
}) {
  const [value, setValue] = useState('');
  const [instrument, setInstrument] = useState<string | null>(instruments[0]?.id ?? null);
  const [note, setNote] = useState('');
  const [answers, setAnswers] = useState<Record<string, 'pass' | 'fail' | 'na'>>({});
  const [error, setError] = useState<string | null>(null);
  const path = `${base}/tasks/${t.id}`;

  if (r.kind === 'measurement') {
    const limit = t.limits.find(l => l.quantity === r.quantity && l.equipmentType === t.equipment?.type);
    const num = Number(value.replace(',', '.'));
    const valid = value.trim() !== '' && Number.isFinite(num);
    const outside = valid && limit && ((limit.min !== null && num < limit.min) || (limit.max !== null && num > limit.max));
    return (
      <Card>
        <Eyebrow>ÖLÇÜM · ZORUNLU</Eyebrow>
        <Text style={[type(13, 600), { marginTop: 10 }]}>{r.quantity === 'temperature' ? 'Ölçülen sıcaklık' : r.quantity} ({r.unit})</Text>
        <Text style={[type(11.5, 400, { color: C.t3 }), { marginTop: 3 }]}>
          {limit ? `Kabul aralığı: ${limit.min ?? '—'} … ${limit.max ?? '—'} ${limit.unit}${limit.basis === 'example' ? ' · ÖRNEK LİMİT, doğrulanmadı' : ''}` : 'Bu ekipman için limit tanımlı değil; sunucu kaydı reddeder.'}
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}><Field testID="measure-value" value={value} onChangeText={setValue} keyboardType="decimal-pad" placeholder="ör. 3,5" /></View>
          <GhostButton testID="measure-save" label="Kaydet" height={48} disabled={!valid}
            onPress={() => { onAdd(`ölçüm ${num} ${r.unit}`, `${path}/measurements`, { quantity: r.quantity, value: num, unit: r.unit, measuredAt: new Date().toISOString(), instrumentId: instrument }); setValue(''); }} />
        </View>
        {instruments.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {instruments.map(i => (
              <Tap key={i.id} onPress={() => setInstrument(i.id)} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: instrument === i.id ? tint.lime(0.4) : C.bd }}>
                <Text style={type(11.5, 600, { color: instrument === i.id ? C.lime : C.t2 })}>{i.name}</Text>
              </Tap>
            ))}
          </View>
        )}
        {outside ? (
          <Rise duration={200} style={{ flexDirection: 'row', gap: 10, borderWidth: 1, borderColor: tint.crit(0.3), backgroundColor: tint.crit(0.08), borderRadius: 14, padding: 13, marginTop: 12 }}>
            <View style={{ marginTop: 1 }}><WarnIcon size={15} stroke={2.2} /></View>
            <View style={{ flex: 1 }}>
              <Text style={type(13, 600, { color: C.crit })}>Limit dışı — yine de kaydedebilirsin</Text>
              <Text style={[type(11.5, 400, { lh: 1.45, color: C.t2 }), { marginTop: 3 }]}>Kontrol "yapıldı, uygunsuz" olarak kapanır ve uygunsuzluk açılır. Gerçek değeri gir.</Text>
            </View>
          </Rise>
        ) : null}
      </Card>
    );
  }

  if (r.kind === 'photo' || r.kind === 'document') {
    // Browsers only offer the hashing API on secure pages (https or localhost).
    const insecureWeb = Platform.OS === 'web' && !globalThis.crypto?.subtle;
    const pick = async () => {
      setError(null);
      if (insecureWeb) { setError(INSECURE_WEB); return; }
      try {
        const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.5, base64: true };
        let res = Platform.OS === 'web' ? await ImagePicker.launchImageLibraryAsync(opts) : await ImagePicker.launchCameraAsync(opts);
        if (res.canceled && Platform.OS !== 'web') res = await ImagePicker.launchImageLibraryAsync(opts);
        if (res.canceled) return;
        const a = res.assets[0]!;
        const b64 = a.base64 ?? (a.uri.startsWith('data:') ? a.uri.split(',')[1] : null);
        const mime = a.mimeType ?? (a.uri.startsWith('data:') ? a.uri.slice(5, a.uri.indexOf(';')) : 'image/jpeg');
        if (!b64) throw new Error('Fotoğraf okunamadı.');
        if (!['image/jpeg', 'image/png'].includes(mime)) throw new Error('Yalnızca JPEG veya PNG kabul edilir.');
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
        const sha256 = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
        onAdd(r.kind === 'photo' ? 'fotoğraf' : 'belge', `${path}/evidence`, { kind: r.kind, mime, sha256, sizeBytes: bytes.length }, { base64: b64, mime, sha256, size: bytes.length });
      } catch (e) { setError((e as Error).message); }
    };
    return (
      <Card>
        <Eyebrow>{r.kind === 'photo' ? 'FOTOĞRAF' : 'BELGE'} · EN AZ {r.min}</Eyebrow>
        <Tap testID="photo-add" onPress={pick} style={{ height: 96, marginTop: 10, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: C.bds, backgroundColor: C.chip, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <CameraIcon />
          <Text style={type(12.5, 600, { color: C.t2 })}>{Platform.OS === 'web' ? 'Fotoğraf seç' : 'Fotoğraf çek'}</Text>
        </Tap>
        <Text style={[type(11, 400, { color: C.t3, lh: 1.4 }), { marginTop: 8 }]}>Dosyanın özeti (SHA-256) cihazda hesaplanır; sunucu aynı özeti doğrulamadan kanıt saymaz.</Text>
        {insecureWeb ? <Text testID="insecure-web" style={[type(11.5, 600, { color: C.warn, lh: 1.45 }), { marginTop: 8 }]}>{INSECURE_WEB}</Text> : null}
        {error ? <ErrorBox message={error} /> : null}
      </Card>
    );
  }

  if (r.kind === 'checklist') {
    const all = r.items.every(i => answers[i.id]);
    return (
      <Card>
        <Eyebrow>KONTROL LİSTESİ</Eyebrow>
        <View style={{ gap: 10, marginTop: 12 }}>
          {r.items.map(i => (
            <View key={i.id} style={{ gap: 6 }}>
              <Text style={type(13, 600)}>{i.label}{i.critical ? '  ·  kritik' : ''}</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {([['pass', 'Uygun'], ['fail', 'Uygun değil'], ['na', 'Yok / uygulanmaz']] as const).map(([v, label]) => {
                  const on = answers[i.id] === v;
                  const bad = v === 'fail';
                  return (
                    <Tap key={v} testID={`check-${i.id}-${v}`} onPress={() => setAnswers(a => ({ ...a, [i.id]: v }))} style={{ flex: 1, height: 38, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
                      borderColor: on ? (bad ? tint.crit(0.5) : tint.lime(0.45)) : C.bds, backgroundColor: on ? (bad ? tint.crit(0.12) : tint.lime(0.1)) : C.chip }}>
                      <Text style={type(11.5, 600, { color: on ? (bad ? C.crit : C.lime) : C.t2 })}>{label}</Text>
                    </Tap>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
        <GhostButton testID="check-save" label="Listeyi kaydet" disabled={!all} style={{ marginTop: 12 }} onPress={() => onAdd('kontrol listesi', `${path}/evidence`, { kind: 'checklist', answers })} />
      </Card>
    );
  }

  if (r.kind === 'note') {
    return (
      <Card>
        <Eyebrow>AÇIKLAMA {r.requiredWhen === 'nonconforming' ? '· SONUÇ UYGUNSUZSA ZORUNLU' : '· ZORUNLU'}</Eyebrow>
        <View style={{ marginTop: 10 }}><Field testID="note-text" value={note} onChangeText={setNote} multiline placeholder="Ne gördün, ne yaptın?" /></View>
        <GhostButton testID="note-save" label="Notu kaydet" disabled={note.trim().length < 3} style={{ marginTop: 10 }} onPress={() => { onAdd('not', `${path}/evidence`, { kind: 'note', text: note.trim() }); setNote(''); }} />
      </Card>
    );
  }

  if (r.kind === 'approval') {
    const mine = role === r.role;
    return (
      <Card>
        <Eyebrow>YETKİLİ ONAYI · {r.role}</Eyebrow>
        <Text style={[type(12.5, 400, { color: C.t2, lh: 1.5 }), { marginTop: 8 }]}>{mine ? 'Bu kontrolü sen onaylayabilirsin.' : 'Bu onayı yalnızca ilgili rol verebilir.'}</Text>
        {mine ? <GhostButton label="Onaylıyorum" style={{ marginTop: 10 }} onPress={() => onAdd('onay', `${path}/evidence`, { kind: 'approval', role: r.role })} /> : null}
      </Card>
    );
  }
  return null;
}
