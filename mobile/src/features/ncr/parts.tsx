import { router } from 'expo-router';
import { personLabel } from '../AssignCard';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../../api/client';
import { useSession } from '../../api/session';
import type { Assignee } from '../../api/types';
import { useApi } from '../../api/useApi';
import { ErrorBox, Field, Loading } from '../../components/states';
import { Callout, Card, Eyebrow, FilterChip, GhostButton, Pill, PrimaryButton, StepMark, Tap } from '../../components/ui';
import { useUi } from '../../state/app';
import { C, tint, type } from '../../theme';
import { fmtDateTime } from '../dates';
import { ROLE_LABEL } from '../labels';
import { fileMeta, openEvidence, pickFile, uploadBytes } from '../files';
import { EvidencePreview } from './EvidencePreview';
import { ACTION_KIND, CAUSE_LABEL, STAGE_LABEL, historyLine, type Cause, type NcrDetail } from './types';

/** Runs a server call with busy / error state and a success toast, then reloads. */
export function useRun(onDone: () => void) {
  const { showToast } = useUi();
  const { call } = useSession();
  const post = (path: string, body: unknown) => call('POST', path, body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, ok: string, sub?: string) => {
    setBusy(true); setError(null);
    try { await fn(); showToast(ok, sub); onDone(); return true; } catch (e) { setError(errorText(e)); return false; } finally { setBusy(false); }
  };
  return { busy, error, run, setError, post };
}

export function FlowStepper({ n }: { n: NcrDetail }) {
  return (
    <Card>
      <Eyebrow>{n.depth === 'capa' ? 'DÜZELTİCİ FAALİYET AKIŞI (TAM CAPA)' : 'DÜZELTME AKIŞI'}{n.iteration > 1 ? ` · ${n.iteration}. TUR` : ''}</Eyebrow>
      <View style={{ marginTop: 14 }}>
        {n.flow.stages.map((s, i) => (
          <View key={s.key} style={{ flexDirection: 'row', gap: 12, alignItems: 'stretch' }}>
            <View style={{ width: 22, alignItems: 'center' }}>
              <StepMark state={s.state} />
              {i < n.flow.stages.length - 1 ? <View style={{ flex: 1, width: 1, backgroundColor: C.bd }} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: i < n.flow.stages.length - 1 ? 14 : 0 }}>
              <Text style={type(13.5, 600, { color: s.state === 'done' ? C.t1 : s.state === 'active' ? C.warn : C.t2 })}>{STAGE_LABEL[s.key]}</Text>
              {s.state !== 'done' && s.missing ? <Text style={[type(11.5, 400, { lh: 1.45, color: C.t3 }), { marginTop: 3 }]}>{s.missing}</Text> : null}
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}

const DUE_PRESETS: [string, number][] = [['4 saat', 4], ['Yarın', 24], ['3 gün', 72], ['1 hafta', 168]];
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Due date: quick choices or a day (end of that day, 18:00). */
export function DuePicker({ value, onChange }: { value: string | null; onChange: (iso: string | null) => void }) {
  const [day, setDay] = useState('');
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
        {DUE_PRESETS.map(([label, h]) => {
          const iso = new Date(Math.ceil((Date.now() + h * 3600_000) / 900_000) * 900_000).toISOString();
          const active = !!value && Math.abs(new Date(value).getTime() - new Date(iso).getTime()) < 60 * 60_000 && !day;
          return <FilterChip key={label} label={label} px={12} active={active} onPress={() => { setDay(''); onChange(iso); }} />;
        })}
      </View>
      <Field label="ya da gün (YYYY-AA-GG)" value={day} placeholder="2026-11-20"
        onChangeText={v => { setDay(v); if (isDay(v)) onChange(new Date(`${v}T18:00:00`).toISOString()); }} />
      {value ? <Text style={type(11.5, 500, { color: C.t2 })}>Termin: {fmtDateTime(value)}</Text> : null}
    </View>
  );
}

export function PersonChips({ siteId, value, onChange }: { siteId: string; value: string | null; onChange: (id: string) => void }) {
  const { company } = useSession();
  const people = useApi<Assignee[]>(company ? `/companies/${company.id}/sites/${siteId}/assignees` : null);
  if (people.error) return <ErrorBox message={people.error} onRetry={people.reload} />;
  if (!people.data) return <Loading label="Ekip yükleniyor…" />;
  if (!people.data.length) return <Text style={type(12.5, 400, { color: C.t2 })}>Bu şubede iş verilebilecek etkin kimse yok.</Text>;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
      {people.data.map(p => <FilterChip key={p.id} testID={`person-${p.id}`} label={`${personLabel(p)} · ${ROLE_LABEL[p.role] ?? p.role}`} px={12} active={value === p.id} onPress={() => onChange(p.id)} />)}
    </View>
  );
}

export function AssignmentCard({ n, base, reload, initialOpen = false }: { n: NcrDetail; base: string; reload: () => void; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen && n.permissions.manage);
  const [owner, setOwner] = useState<string | null>(n.owner?.id ?? null);
  const [due, setDue] = useState<string | null>(n.due_at);
  const [reason, setReason] = useState('');
  const { busy, error, run, post } = useRun(() => { setOpen(false); reload(); });
  const assigned = n.history.some(h => h.event_type === 'nonconformity.assigned');
  const dueChanged = !!n.due_at && !!due && new Date(due).getTime() !== new Date(n.due_at).getTime();
  return (
    <Card radius={22} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Eyebrow>SORUMLU VE TERMİN</Eyebrow>
          <Text testID="ncr-owner" style={[type(14, 600, { color: n.owner ? (n.owner.active ? C.t1 : C.crit) : C.warn }), { marginTop: 6 }]}>
            {n.owner ? `${n.owner.name}${n.owner.active ? '' : ' · pasif, yeniden atanmalı'}` : 'Sorumlu atanmadı'}
          </Text>
          <Text style={[type(12, 500, { color: n.overdue ? C.crit : C.t3 }), { marginTop: 3 }]}>
            {n.due_at ? `Termin ${fmtDateTime(n.due_at)}${n.overdue ? ' · GECİKMİŞ' : ''}${assigned ? '' : ' (örnek yanıt süresi politikasından)'}` : 'Termin yok'}
          </Text>
        </View>
        {n.permissions.manage && n.status !== 'closed' && !open ? <GhostButton testID="ncr-assign-open" label={n.owner ? 'Değiştir' : 'Ata'} height={36} size={12} onPress={() => setOpen(true)} /> : null}
      </View>
      {open && (
        <View style={{ gap: 10, marginTop: 4 }}>
          <PersonChips siteId={n.site_id} value={owner} onChange={setOwner} />
          <DuePicker value={due} onChange={setDue} />
          {assigned && dueChanged ? <Field label="Termin değişikliğinin gerekçesi" testID="ncr-due-reason" value={reason} onChangeText={setReason} placeholder="ör. Yedek parça cuma geliyor" /> : null}
          {error ? <ErrorBox message={error} /> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <PrimaryButton testID="ncr-assign-save" label={busy ? 'Kaydediliyor…' : 'Kaydet'} glow={false} height={44} size={13} style={{ flex: 1 }}
              disabled={busy || !owner || !due || (assigned && dueChanged && reason.trim().length < 5)}
              onPress={() => run(() => post(base + '/assignment', { ownerId: owner, dueAt: due, reason: reason.trim() || null }), 'Sorumlu ve termin kaydedildi', 'Kişiye bildirim gitti.')} />
            <GhostButton label="Vazgeç" height={44} size={13} onPress={() => setOpen(false)} />
          </View>
        </View>
      )}
    </Card>
  );
}

function CauseChips({ value, onChange }: { value: Cause[]; onChange: (v: Cause[]) => void }) {
  return (
    <View style={{ gap: 7 }}>
      {(Object.keys(CAUSE_LABEL) as Cause[]).map(c => {
        const on = value.includes(c);
        return (
          <Tap key={c} testID={`cause-${c}`} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
            onPress={() => onChange(on ? value.filter(x => x !== c) : [...value, c])}
            style={{ flexDirection: 'row', gap: 10, alignItems: 'center', borderWidth: 1, borderColor: on ? tint.lime(0.4) : C.bd, backgroundColor: on ? tint.lime(0.07) : C.chip, borderRadius: 16, padding: 11 }}>
            <View style={{ width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: on ? C.lime : C.ringIdle, backgroundColor: on ? C.lime : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={type(11, 800, { color: C.ink })}>{on ? '✓' : ''}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={type(13, 600, { color: on ? C.lime : C.t1 })}>{CAUSE_LABEL[c][0]}</Text>
              <Text style={type(11.5, 400, { color: C.t3 })}>{CAUSE_LABEL[c][1]}</Text>
            </View>
          </Tap>
        );
      })}
    </View>
  );
}

export function CauseCard({ n, base, reload }: { n: NcrDetail; base: string; reload: () => void }) {
  const [stage, setStage] = useState<'initial' | 'verified' | null>(null);
  const [cats, setCats] = useState<Cause[]>([]);
  const [notes, setNotes] = useState('');
  const { busy, error, run, post } = useRun(() => { setStage(null); setCats([]); setNotes(''); reload(); });
  const { initial, verified } = n.cause;
  const verifiedThisRound = !!verified && (verified.iteration === n.iteration || verified.migrated);
  const show = (c: NonNullable<typeof initial>) => c.categories.length ? c.categories.map(x => CAUSE_LABEL[x][0]).join(' · ') : 'Önceki sürümden (serbest metin)';
  return (
    <Card radius={22} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 10 }}>
      <Eyebrow>NEDEN DEĞERLENDİRMESİ</Eyebrow>
      {initial ? (
        <View style={{ gap: 3 }}>
          <Text style={type(10, 700, { ls: 0.08, color: C.info })}>İLK DEĞERLENDİRME · kesin kök neden değildir</Text>
          <Text testID="cause-initial" style={type(13.5, 600)}>{show(initial)}</Text>
          <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>{initial.notes}</Text>
          <Text style={type(11, 400, { color: C.t3 })}>{initial.done_by_name} · {fmtDateTime(initial.done_at)}</Text>
        </View>
      ) : <Text style={type(12.5, 400, { color: C.t2 })}>Henüz değerlendirme yok. Neden(ler)i seçmek uygun desteği önerir; birden fazla seçilebilir.</Text>}
      {n.depth === 'capa' ? (verified ? (
        <View style={{ gap: 3, borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 10 }}>
          <Text style={type(10, 700, { ls: 0.08, color: verifiedThisRound ? C.lime : C.warn })}>DOĞRULANMIŞ KÖK NEDEN{verifiedThisRound ? '' : ' · önceki tur; bu tur için yeniden doğrulanmalı'}</Text>
          <Text testID="cause-verified" style={type(13.5, 600)}>{show(verified)}</Text>
          <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>{verified.notes}</Text>
          <Text style={type(11, 400, { color: C.t3 })}>{verified.done_by_name} · {fmtDateTime(verified.done_at)}</Text>
        </View>
      ) : initial ? <Text style={type(11.5, 400, { color: C.t3 })}>Kök neden henüz doğrulanmadı (yönetici, dayanağıyla birlikte doğrular).</Text> : null) : null}
      {n.status !== 'closed' && stage === null ? (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {n.permissions.act ? <GhostButton testID="cause-initial-open" label={initial ? 'İlk değerlendirmeyi güncelle' : 'Neden(ler)i seç'} height={38} size={12} onPress={() => { setStage('initial'); setCats(initial?.categories ?? []); }} /> : null}
          {n.depth === 'capa' && n.permissions.manage && initial ? <GhostButton testID="cause-verified-open" label="Kök nedeni doğrula" height={38} size={12} color={C.lime} border={tint.lime(0.35)} onPress={() => { setStage('verified'); setCats(initial.categories); }} /> : null}
        </View>
      ) : null}
      {stage ? (
        <View style={{ gap: 10 }}>
          <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>{stage === 'initial' ? 'İlk görüşün; kesin sonuç sayılmaz. Birden fazla neden seçebilirsin.' : 'Yalnız kanıtla desteklenen nedenleri işaretle; neye dayandığını yaz (ölçüm, servis raporu, gözlem).'}</Text>
          <CauseChips value={cats} onChange={setCats} />
          <Field label={stage === 'initial' ? 'Kısa açıklama' : 'Dayanak'} testID="cause-notes" value={notes} onChangeText={setNotes} multiline />
          {error ? <ErrorBox message={error} /> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <PrimaryButton testID="cause-save" label={busy ? 'Kaydediliyor…' : 'Kaydet'} glow={false} height={44} size={13} style={{ flex: 1 }}
              disabled={busy || !cats.length || notes.trim().length < (stage === 'verified' ? 10 : 5)}
              onPress={() => run(() => post(base + '/causes', { stage, categories: cats, notes: notes.trim() }), stage === 'initial' ? 'Değerlendirme kaydedildi' : 'Kök neden doğrulandı', stage === 'initial' ? 'Önerilen destek aşağıda.' : undefined)} />
            <GhostButton label="Vazgeç" height={44} size={13} onPress={() => setStage(null)} />
          </View>
        </View>
      ) : null}
    </Card>
  );
}

/** Suggestions only lead somewhere; nothing is ordered or closed without the user. */
/**
 * A service already done for another case of the same equipment may also cover this case. A manager links it with a stated basis; only then can that
 * report be the required service evidence of a task. Without the link it stays visible as supporting material.
 */
export function ServiceLinkCard({ n, base, reload }: { n: NcrDetail; base: string; reload: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [basis, setBasis] = useState('');
  const { busy, error, run, post } = useRun(() => { setOpen(null); setBasis(''); reload(); });
  const sl = n.serviceLinks;
  if (!sl || (sl.linked.length === 0 && sl.linkable.length === 0)) return null;
  return (
    <View testID="ncr-service-links"><Card radius={22} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 10 }}>
      <Eyebrow color={C.info}>BAŞKA VAKANIN SERVİSİ</Eyebrow>
      <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Aynı ekipmanın başka bir vakası için yapılmış servis bu vakanın arızasını da kapsadıysa, bunu burada dayanağıyla kaydet. Kaydedilmeyen servis raporu yalnız destekleyici ek olarak görünür; görevin zorunlu servis kanıtını karşılamaz.</Text>
      {sl.linked.map(l => (
        <View key={l.id} testID={`ncr-service-linked-${l.job_id}`} style={{ gap: 3, borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 8 }}>
          <Text style={type(12.5, 600)}>{l.request_title} · rapor sürümü {l.version_number}</Text>
          <Text style={type(11.5, 400, { color: C.t2, lh: 1.45 })}>Kaynak vaka: {l.source_case_title ?? '—'} · ilişkilendiren: {l.linked_by} · {fmtDateTime(l.linked_at)}</Text>
          <Text style={type(11.5, 400, { color: C.t2, lh: 1.45 })}>Dayanak: {l.basis}</Text>
        </View>
      ))}
      {sl.linkable.map(s => (
        <View key={s.job_id} testID={`ncr-service-linkable-${s.job_id}`} style={{ gap: 4, borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 8 }}>
          <Text style={type(12.5, 600)}>{s.request_title} · rapor sürümü {s.version}</Text>
          <Text style={type(11.5, 400, { color: C.t2, lh: 1.45 })}>Kaynak vaka: {s.source_case_title ?? '—'} · talep {fmtDateTime(s.request_created_at)} · rapor {fmtDateTime(s.uploaded_at)}</Text>
          {open === s.job_id ? (
            <View style={{ gap: 7 }}>
              <Field label="Dayanak (zorunlu, en az 15 karakter)" testID="ncr-service-link-basis" value={basis} onChangeText={setBasis} multiline placeholder="Servis bu vakanın arızasını da kapsıyor mu, nasıl biliniyor? (ör. rapor 2. sayfa madde 4)" />
              {error ? <ErrorBox message={error} /> : null}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <PrimaryButton testID="ncr-service-link-save" label={busy ? 'Kaydediliyor…' : 'Bu servis bu vakayı da kapsıyor'} glow={false} height={38} size={12} style={{ flex: 1 }}
                  disabled={busy || basis.trim().length < 15} onPress={() => run(() => post(`${base}/service-links`, { jobId: s.job_id, basis: basis.trim() }), 'Servis vakayla ilişkilendirildi', 'Kayıt geçmişe yazıldı.')} />
                <GhostButton label="Vazgeç" height={38} size={12} onPress={() => { setOpen(null); setBasis(''); }} />
              </View>
              {basis.trim().length < 15 ? <Text style={type(11.5, 500, { color: C.t3 })}>Düğme, dayanak en az 15 karakter olunca açılır.</Text> : null}
            </View>
          ) : <GhostButton testID={`ncr-service-link-open-${s.job_id}`} label="Bu servisi bu vakayla ilişkilendir" height={36} size={12} style={{ alignSelf: 'flex-start' }} onPress={() => setOpen(s.job_id)} />}
        </View>
      ))}
    </Card></View>
  );
}

export function SupportCard({ n, base, reload, onFollowUp, onAssign }: { n: NcrDetail; base: string; reload: () => void; onFollowUp: () => void; onAssign: () => void }) {
  const [deciding, setDeciding] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [instead, setInstead] = useState('');
  const { busy, error, run, post } = useRun(() => { setDeciding(null); setReason(''); setInstead(''); reload(); });
  if (!n.suggestions.length || n.status === 'closed') return null;
  // A critical case's first step comes first; suggestions wait until it is done.
  if (n.firstAction) return (
    <Card radius={22} style={{ paddingVertical: 13, paddingHorizontal: 16, gap: 6 }}>
      <Eyebrow color={C.t3}>ÖNERİLEN DESTEK · BEKLİYOR</Eyebrow>
      <Text testID="support-waiting" style={type(12, 400, { color: C.t3, lh: 1.45 })}>Önce yukarıdaki kritik ilk işlemler yapılmalı; {n.suggestions.length} öneri ondan sonra gösterilir.</Text>
    </Card>
  );
  const go = (kind: string, cat: string | null) => {
    if (kind === 'explanation' && n.task) router.push(`/obligation/${n.task.obligation_id}`);
    else if (kind === 'service_request') router.push(`/service/new?ncrId=${n.id}&title=${encodeURIComponent(n.title)}${cat ? `&category=${cat}` : ''}`);
    else if (kind === 'equipment') router.push('/equipment');
    else if (kind === 'equipment_history' && n.equipment) router.push(`/equipment/${n.equipment.id}`);
    else if (kind === 'team') router.push('/team');
    else if (kind === 'follow_up') onFollowUp();
    else if (kind === 'assign') onAssign();
    else if (kind === 'training') router.push(`/training/assign?ncrId=${n.id}`);
  };
  const label: Record<string, string> = { explanation: 'Açıklamayı aç', service_request: 'Talep formunu aç', equipment: 'Ekipmanlar', equipment_history: 'Ekipman geçmişi', team: 'Ekip', follow_up: 'Takip aksiyonu ekle', assign: 'Sorumluyu değiştir', training: 'Eğitim ata' };
  return (
    <Card radius={22} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 10 }}>
      <Eyebrow color={C.lime}>ÖNERİLEN DESTEK</Eyebrow>
      <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>İlk değerlendirmedeki nedenlere göre. Öneriler yalnızca yol gösterir; sen onaylamadan hiçbir talep, sipariş ya da kapanış olmaz.</Text>
      {n.suggestions.length > 1 ? <Text style={type(11.5, 500, { color: C.t2 })}>{new Set(n.suggestions.map(s => s.category)).size} neden için {n.suggestions.length} öneri.</Text> : null}
      {n.suggestions.map((s, i) => s.dismissed ? (
        <View key={i} testID={`support-${s.kind}`} style={{ borderWidth: 1, borderColor: C.bd, borderStyle: 'dashed', borderRadius: 16, padding: 12, gap: 4 }}>
          <Text style={type(10, 700, { ls: 0.08, color: C.t3 })}>{CAUSE_LABEL[s.category][0].toUpperCase()} · KENARA KONULDU</Text>
          <Text style={type(12.5, 600, { color: C.t2 })}>{s.title}</Text>
          <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Gerekçe: {s.dismissed.reason}{s.dismissed.replacement ? ` · Yerine: ${s.dismissed.replacement}` : ''} · {s.dismissed.by}</Text>
          {n.permissions.act ? <Text testID={`support-restore-${s.key}`} onPress={() => setDeciding(`restore:${s.key}`)} style={type(11.5, 600, { color: C.info })}>Geri al</Text> : null}
          {deciding === `restore:${s.key}` ? <DecideBox reason={reason} setReason={setReason} busy={busy} error={error} label="Öneriyi geri al"
            onSave={() => run(() => post(`${base}/suggestions`, { key: s.key, decision: 'restored', reason: reason.trim() }), 'Öneri geri alındı')} onCancel={() => setDeciding(null)} /> : null}
        </View>
      ) : (
        <View key={i} testID={`support-${s.kind}`} style={{ borderWidth: 1, borderColor: C.bd, borderRadius: 16, padding: 12, gap: 6 }}>
          <Text style={type(10, 700, { ls: 0.08, color: C.t3 })}>{CAUSE_LABEL[s.category][0].toUpperCase()}</Text>
          <Text style={type(13.5, 600)}>{s.title}</Text>
          <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>{s.body}</Text>
          {s.kind === 'training' && n.relatedTraining.length ? <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>İlgili: {n.relatedTraining.slice(0, 3).map(t => t.title).join(' · ')}</Text> : null}
          {s.available && label[s.kind] && (s.kind !== 'service_request' || n.permissions.serviceRequest) && (s.kind !== 'assign' || n.permissions.manage) && (s.kind !== 'training' || n.permissions.manage) ? (
            <GhostButton testID={`support-go-${s.kind}`} label={label[s.kind]!} height={36} size={12} style={{ alignSelf: 'flex-start' }} onPress={() => go(s.kind, s.serviceCategory)} />
          ) : !s.available ? <Pill label={s.kind === 'training' ? 'HENÜZ YOK' : 'BU KAYITTA YOK'} fg={C.t3} bg={tint.white(0.06)} style={{ alignSelf: 'flex-start' }} />
            : <Text style={type(11.5, 500, { color: C.t3 })}>{s.kind === 'service_request' ? 'Talebi işletme sahibi ya da yönetici açar; onlara bildirebilirsin.' : 'Bu adımı yönetici yapar.'}</Text>}
          {n.permissions.act && deciding !== `dismiss:${s.key}` ? <Text testID={`support-dismiss-${s.key}`} onPress={() => setDeciding(`dismiss:${s.key}`)} style={type(11.5, 500, { color: C.t3 })}>Bu öneri uymuyor · gerekçeyle değiştir</Text> : null}
          {deciding === `dismiss:${s.key}` ? <DecideBox reason={reason} setReason={setReason} instead={instead} setInstead={setInstead} busy={busy} error={error} label="Kenara koy"
            onSave={() => run(() => post(`${base}/suggestions`, { key: s.key, decision: 'dismissed', reason: reason.trim(), replacement: instead.trim() || null }), 'Öneri kenara konuldu', 'Gerekçe geçmişe yazıldı.')} onCancel={() => setDeciding(null)} /> : null}
        </View>
      ))}
      {n.services.length ? (
        <View style={{ gap: 6, borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 10 }}>
          <Text style={type(10, 700, { ls: 0.08, color: C.t3 })}>BAĞLI HİZMET TALEPLERİ</Text>
          {n.services.map(s => (
            <Tap key={s.id} onPress={() => router.push(`/service/${s.id}`)}>
              <Text style={type(12.5, 600)}>{s.title} · {SERVICE_STATUS[s.job_status ?? s.status] ?? s.status} ›</Text>
            </Tap>
          ))}
          <Text style={type(11, 400, { color: C.t3 })}>Hizmetin teslim kabulü bu kaydı kapatmaz; etkinlik kontrolü ve doğrulama ayrıca yapılır.</Text>
        </View>
      ) : null}
    </Card>
  );
}
function DecideBox({ reason, setReason, instead, setInstead, busy, error, label, onSave, onCancel }: { reason: string; setReason: (v: string) => void; instead?: string; setInstead?: (v: string) => void;
  busy: boolean; error: string | null; label: string; onSave: () => void; onCancel: () => void }) {
  return (
    <View style={{ gap: 7, borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 8 }}>
      <Field label="Gerekçe (zorunlu)" testID="support-reason" value={reason} onChangeText={setReason} multiline placeholder="ör. Conta yeni değişti; sorun kapı menteşesinde." />
      {setInstead ? <Field label="Yerine ne yapılacak (isteğe bağlı)" testID="support-instead" value={instead} onChangeText={setInstead} /> : null}
      {error ? <ErrorBox message={error} /> : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <PrimaryButton testID="support-decide-save" label={busy ? 'Kaydediliyor…' : label} glow={false} height={38} size={12} style={{ flex: 1 }} disabled={busy || reason.trim().length < 10} onPress={onSave} />
        <GhostButton label="Vazgeç" height={38} size={12} onPress={onCancel} />
      </View>
    </View>
  );
}

/** One look: how far, who is next and what, what is still missing for closure. */
export function CaseSummary({ n }: { n: NcrDetail }) {
  const STAGE_TR: Record<string, string> = { ...STAGE_LABEL, closed: 'Kapandı' };
  return (
    <Card radius={22} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 9 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Eyebrow style={{ flex: 1 }}>DURUM · {n.progress.done}/{n.progress.total} AŞAMA{n.iteration > 1 ? ` · ${n.iteration}. TUR` : ''}</Eyebrow>
        {n.next.mine ? <Pill label="SIRA SENDE" fg={C.lime} bg={tint.lime(0.12)} /> : null}
      </View>
      <View testID="ncr-next" style={{ gap: 3 }}>
        <Text style={type(10, 700, { ls: 0.08, color: C.t3 })}>SIRADA · {(STAGE_TR[n.next.stage] ?? n.next.stage).toLocaleUpperCase('tr')}</Text>
        <Text style={type(13.5, 600, { lh: 1.4 })}>{n.next.what}</Text>
        <Text style={type(12, 400, { color: C.t2 })}>Kim: {n.next.who}</Text>
      </View>
      {n.status !== 'closed' && n.closureMissing.length ? (
        <View testID="ncr-missing" style={{ gap: 3, borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 8 }}>
          <Text style={type(10, 700, { ls: 0.08, color: C.t3 })}>KAPANIŞ İÇİN EKSİK</Text>
          {n.closureMissing.map(m => <Text key={m.stage} style={type(12, 400, { color: C.t2, lh: 1.45 })}>· {STAGE_LABEL[m.stage]}{m.missing ? `: ${m.missing}` : ''}</Text>)}
        </View>
      ) : null}
    </Card>
  );
}

/** Critical / high risk: the manager's first step is shown before anything else. */
export function CriticalFirst({ n, onAssign }: { n: NcrDetail; onAssign: () => void }) {
  if (!n.firstAction) return null;
  return (
    <View testID="ncr-critical-first" style={{ borderWidth: 1.5, borderColor: C.crit, backgroundColor: tint.crit(0.08), borderRadius: 20, padding: 15, gap: 8 }}>
      <Text style={type(10.5, 800, { ls: 0.1, color: C.crit })}>{n.firstAction.level === 'critical' ? 'KRİTİK RİSK' : 'YÜKSEK RİSK'} · ÖNCE BUNLAR</Text>
      {n.firstAction.items.map((it, i) => (
        <View key={it.key} style={{ flexDirection: 'row', gap: 8 }}>
          <Text style={type(13, 700, { color: C.crit })}>{i + 1}.</Text>
          <Text style={[type(13, 500, { lh: 1.45 }), { flex: 1 }]}>{it.text}</Text>
        </View>
      ))}
      {n.firstAction.items.some(i => i.key === 'assignment') && n.permissions.manage ? (
        <GhostButton testID="ncr-critical-assign" label="Sorumlu ve termin ata" height={38} size={12} color={C.crit} border={tint.crit(0.4)} style={{ alignSelf: 'flex-start' }} onPress={onAssign} />
      ) : null}
      <Text style={type(11, 400, { color: C.t3 })}>{n.firstAction.note}</Text>
    </View>
  );
}

/** Records linked to the case, each opened in its own screen (back returns here). */
export function LinkedRecords({ n }: { n: NcrDetail }) {
  const { role } = useSession();
  const evidence = n.actions.flatMap(a => a.evidence.filter(e => e.status === 'stored'));
  // An outside verifier (no role in this business) may read only the case and its evidence; the task, equipment,
  // document and service screens would answer "not found", so those links are not offered.
  const all: { key: string; label: string; sub: string; go: () => void }[] = [
    ...(n.task ? [{ key: `task-${n.task.id}`, label: `Kontrol: ${n.task.title}`, sub: 'Kaydın açıldığı görev', go: () => router.push(`/task/${n.task!.id}`) }] : []),
    ...(n.equipment ? [{ key: `equipment-${n.equipment.id}`, label: `Ekipman: ${n.equipment.name}`, sub: 'Geçmiş kayıtlar, hizmetler, belgeler, son ölçümler', go: () => router.push(`/equipment/${n.equipment!.id}`) }] : []),
    ...n.documents.map(d => ({ key: `doc-${d.id}`, label: `Belge: ${d.title}`, sub: 'Ekipmanın belgesi', go: () => router.push(`/documents/${d.id}`) })),
    ...n.services.map(s => ({ key: `svc-${s.id}`, label: `Hizmet: ${s.title}`, sub: SERVICE_STATUS[s.job_status ?? s.status] ?? s.status, go: () => router.push(`/service/${s.id}`) })),
    ...n.trainings.map(t => ({ key: `tr-${t.id}`, label: `Eğitim: ${t.title}`, sub: t.userName, go: () => router.push(`/training/a/${t.id}`) })),
  ];
  const rows = role ? all : [];
  if (!rows.length && !evidence.length) return null;
  return (
    <Card radius={22} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 8 }}>
      <Eyebrow>İLGİLİ KAYITLAR</Eyebrow>
      {rows.map(r => (
        <Tap key={r.key} testID={`ncr-link-${r.key}`} onPress={r.go} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
          <View style={{ flex: 1 }}>
            <Text style={type(13, 600)} numberOfLines={2}>{r.label}</Text>
            <Text style={type(11, 400, { color: C.t3 })}>{r.sub}</Text>
          </View>
          <Text style={type(15, 400, { color: C.t3 })}>›</Text>
        </Tap>
      ))}
      {evidence.length ? <Text style={type(11.5, 400, { color: C.t3 })}>{evidence.length} kanıt dosyası aksiyonların altında açılır.</Text> : null}
    </Card>
  );
}

const SERVICE_STATUS: Record<string, string> = { open: 'teklif bekleniyor', awarded: 'iş verildi', completed: 'tamamlandı', cancelled: 'iptal', accepted: 'teslim kabul edildi', disputed: 'itiraz edildi', report_submitted: 'rapor geldi', checked_in: 'uzman geldi', scheduled: 'planlandı' };

export function ActionsCard({ n, base, reload, me, formKind, setFormKind }: {
  n: NcrDetail; base: string; reload: () => void; me: string | null; formKind: string | null; setFormKind: (k: string | null) => void;
}) {
  const [desc, setDesc] = useState('');
  const [owner, setOwner] = useState<string | null>(null);
  const [due, setDue] = useState<string | null>(null);
  const [evReq, setEvReq] = useState<'none' | 'photo' | 'document'>('none');
  const { busy, error, run, post } = useRun(() => { setFormKind(null); setDesc(''); setOwner(null); setDue(null); setEvReq('none'); reload(); });
  const canAdd = n.permissions.act && n.status === 'open';
  const kinds = n.depth === 'capa' ? ['correction', 'corrective_action', 'follow_up'] : ['correction', 'follow_up'];
  const rounds = [...new Set(n.actions.map(a => a.iteration))].sort((a, b) => b - a);
  return (
    <Card radius={22} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 10 }}>
      <Eyebrow>AKSİYONLAR</Eyebrow>
      <Text testID="actions-verification-policy" style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>{n.verificationPolicy}</Text>
      {n.actions.length === 0 ? <Text style={type(12.5, 400, { color: C.t2 })}>Henüz aksiyon yok. {n.depth === 'capa' ? 'Tam CAPA: en az bir düzeltme ve bir düzeltici faaliyet gerekir.' : 'En az bir düzeltme gerekir.'}</Text> : null}
      {rounds.map(r => (
        <View key={r} style={{ gap: 8 }}>
          {rounds.length > 1 || n.iteration > 1 ? <Text testID={`round-${r}`} style={type(10, 700, { ls: 0.08, color: r === n.iteration ? C.lime : C.t3 })}>{r}. TUR{r === n.iteration ? ' · GÜNCEL' : ''}</Text> : null}
          {n.verifications.filter(v => v.iteration === r && v.result !== 'effective').map((v, i) => (
            <Text key={i} style={type(11.5, 400, { color: C.crit, lh: 1.45 })}>{v.result === 'reopened' ? 'Yeniden açıldı' : 'Doğrulama: etkili değil'} · {v.verified_by_name} · {fmtDateTime(v.verified_at)} · {v.notes}</Text>
          ))}
          {n.actions.filter(a => a.iteration === r).map(a => <ActionRow key={a.id} a={a} n={n} base={base} reload={reload} me={me} />)}
        </View>
      ))}
      {canAdd && formKind === null ? <GhostButton testID="action-add-open" label="Aksiyon ekle" height={40} size={12.5} style={{ alignSelf: 'flex-start' }} onPress={() => setFormKind(kinds[0]!)} /> : null}
      {canAdd && formKind ? (
        <View style={{ gap: 10, borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 10 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
            {kinds.map(k => <FilterChip key={k} label={ACTION_KIND[k]!} px={12} active={formKind === k} onPress={() => setFormKind(k)} />)}
          </View>
          <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>{formKind === 'correction' ? 'Bu sorunu gider (ör. contayı değiştir).' : formKind === 'corrective_action' ? 'Tekrarını önleyecek değişiklik (ör. bakım planına ekle).' : 'Süreç için sorumlusu ve termini belli bir takip işi.'}</Text>
          <Field label="Ne yapılacak" testID="action-desc" value={desc} onChangeText={setDesc} multiline />
          {n.permissions.manage ? <><Text style={type(12, 600, { color: C.t2 })}>Sorumlu (boş bırakılırsa sen)</Text><PersonChips siteId={n.site_id} value={owner} onChange={setOwner} /></> : null}
          <DuePicker value={due} onChange={setDue} />
          <Text style={type(12, 600, { color: C.t2 })}>"Yapıldı" denmeden önce istenecek kanıt</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
            {([['none', 'Kanıt istenmez'], ['photo', 'Fotoğraf'], ['document', 'Belge']] as const).map(([k, l]) =>
              <FilterChip key={k} testID={`action-evidence-${k}`} label={l} px={12} active={evReq === k} onPress={() => setEvReq(k)} />)}
          </View>
          <Text style={type(11, 400, { color: C.t3, lh: 1.45 })}>Her "yapıldı" beyanı, başka bir yetkili doğrulayana kadar sonuç sayılmaz.</Text>
          {error ? <ErrorBox message={error} /> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <PrimaryButton testID="action-save" label={busy ? 'Kaydediliyor…' : 'Aksiyonu ekle'} glow={false} height={44} size={13} style={{ flex: 1 }} disabled={busy || desc.trim().length < 5}
              onPress={() => run(() => post(base + '/actions', { kind: formKind, description: desc.trim(), ownerId: owner, dueAt: due, evidenceRequired: evReq }), 'Aksiyon eklendi', owner && owner !== me ? 'Sorumluya bildirim gitti.' : undefined)} />
            <GhostButton label="Vazgeç" height={44} size={13} onPress={() => setFormKind(null)} />
          </View>
        </View>
      ) : null}
      {n.status === 'awaiting_verification' ? <Text style={type(11.5, 400, { color: C.t3 })}>Doğrulama beklenirken aksiyon değişmez.</Text> : null}
    </Card>
  );
}

const EV_LABEL: Record<string, string> = { photo: 'fotoğraf', document: 'belge' };

/** Where the claim stands: declared → verified (counts) or rejected (open again). */
function claimState(a: NcrDetail['actions'][number]): { label: string; color: string } {
  if (a.status === 'cancelled') return { label: 'İPTAL', color: C.t3 };
  if (a.status === 'done') {
    if (a.verification_status === 'verified') return { label: a.verification_mode === 'self' ? 'DOĞRULANDI · ÖZ DOĞRULAMA' : a.verified_via === 'grant' ? 'DOĞRULANDI · DIŞ DOĞRULAYICI' : 'DOĞRULANDI', color: a.verification_mode === 'self' ? C.warn : C.lime };
    if (a.verification_status === 'legacy') return a.legacy_unverified ? { label: 'ESKİ KAYIT · DOĞRULANMADI', color: C.warn } : { label: 'TAMAMLANDI (ESKİ KAYIT)', color: C.lime };
    return { label: 'YAPILDI BEYANI · DOĞRULAMA BEKLİYOR', color: C.warn };
  }
  if (a.verification_status === 'rejected') return { label: 'BEYAN REDDEDİLDİ · AÇIK', color: C.crit };
  return { label: a.overdue ? 'GECİKMİŞ' : 'AÇIK', color: a.overdue ? C.crit : C.warn };
}

function ActionRow({ a, n, base, reload, me }: { a: NcrDetail['actions'][number]; n: NcrDetail; base: string; reload: () => void; me: string | null }) {
  const [mode, setMode] = useState<'done' | 'cancel' | 'reassign' | 'verify' | null>(null);
  const [notes, setNotes] = useState('');
  const [owner, setOwner] = useState<string | null>(null);
  const [doer, setDoer] = useState<string | null>(null);
  const [selfConfirm, setSelfConfirm] = useState(false);
  const { token, company } = useSession();
  const { busy, error, run, post, setError } = useRun(() => { setMode(null); setNotes(''); setDoer(null); setSelfConfirm(false); reload(); });
  const verifySelf = mode === 'verify' && !a.can_verify && a.can_self_verify;
  const minNotes = verifySelf ? 20 : 5;
  const editable = a.status === 'open' && n.status === 'open';
  const st = claimState(a);
  const stored = a.evidence.filter(e => e.status === 'stored');
  const needsEvidence = a.evidence_required !== 'none' && !stored.some(e => e.kind === a.evidence_required);
  const addEvidence = async () => {
    setError(null);
    try {
      const kind = a.evidence_required === 'document' ? 'document' : 'photo';
      const f = await pickFile(kind);
      if (!f) return;
      await run(async () => {
        const r = await post(`${base}/actions/${a.id}/evidence`, { kind, ...fileMeta(f) }) as { id: string };
        await uploadBytes(token, company!.id, r.id, f);
      }, 'Kanıt eklendi', 'Dosyanın özeti sunucuda doğrulandı.');
    } catch (e) { setError((e as Error).message); }
  };
  const open = async (id: string) => { setError(null); try { await openEvidence(token, company!.id, id); } catch (e) { setError((e as Error).message); } };
  return (
    <View testID={`action-${a.id}`} style={{ borderWidth: 1, borderColor: a.overdue && a.status === 'open' ? tint.crit(0.3) : a.can_verify ? tint.warn(0.35) : C.bd, borderRadius: 16, padding: 12, gap: 5 }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Text style={[type(10, 700, { ls: 0.08, color: C.t3 }), { flex: 1 }]}>{ACTION_KIND[a.kind]!.toUpperCase()}</Text>
        <Text testID={`action-state-${a.id}`} style={type(10, 700, { ls: 0.08, color: st.color })}>{st.label}</Text>
      </View>
      <Text style={type(13.5, 600, { lh: 1.35 })}>{a.description}</Text>
      <Text style={type(11.5, 400, { color: a.owner_inactive ? C.crit : C.t3 })}>
        {a.owner_name ?? 'Sorumlu yok'}{a.owner_inactive ? ' (pasif)' : ''}{a.due_at ? ` · termin ${fmtDateTime(a.due_at)}` : ''}
        {a.evidence_required !== 'none' ? ` · ${EV_LABEL[a.evidence_required]} kanıtı gerekli` : ''}
      </Text>
      {a.result_notes ? <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>{a.status === 'cancelled' ? 'İptal gerekçesi: ' : a.status === 'done' ? 'Beyan: ' : 'Önceki beyan: '}{a.result_notes}</Text> : null}
      {a.status === 'done' ? (
        <Text testID={`action-roles-${a.id}`} style={type(11, 400, { color: C.t3, lh: 1.5 })}>
          Sorumlu: {a.owner_name ?? '—'} · İşi yapan: {a.performed_by_name ?? a.done_by_name ?? '—'} · Beyan eden: {a.done_by_name ?? '—'}
          {a.evidence.length ? ` · Kanıt: ${a.evidence.length} dosya` : ''}{a.verified_by_name && a.verification_status === 'verified' ? ` · Doğrulayan: ${a.verified_by_name}` : ''}
        </Text>
      ) : null}
      {a.verification_notes && a.verification_status !== 'declared' ? (
        <Text style={type(12, 400, { color: a.verification_status === 'rejected' ? C.crit : C.t2, lh: 1.45 })}>
          {a.verification_status === 'rejected' ? 'Reddedildi: ' : 'Doğrulama: '}{a.verification_notes}{a.verified_by_name ? ` · ${a.verified_by_name}` : ''}
        </Text>
      ) : null}
      {a.evidence.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
          {a.evidence.map((e, i) => e.status === 'stored'
            ? (e.kind === 'photo'
              ? <EvidencePreview key={e.id} id={e.id} label={`FOTOĞRAF ${i + 1}`} />
              : <Tap key={e.id} testID={`action-evidence-open-${e.id}`} onPress={() => open(e.id)}><Pill label={`BELGE ${i + 1} · AÇ`} fg={C.info} bg={tint.info(0.12)} /></Tap>)
            : <Pill key={e.id} label={e.status === 'pending_upload' ? 'YÜKLENİYOR' : 'REDDEDİLEN DOSYA'} fg={e.status === 'rejected' ? C.crit : C.t3} bg={C.chip} />)}
        </View>
      ) : null}
      {a.verify_blocked_reason ? <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>{a.verify_blocked_reason}</Text> : null}
      {a.verify_blocked_reason && !a.can_self_verify && n.permissions.inviteVerifier ? (
        <GhostButton testID={`action-invite-verifier-${a.id}`} label="Dış doğrulayıcı davet et" height={34} size={11.5} style={{ alignSelf: 'flex-start' }} onPress={() => router.push(`/verifiers?ncrId=${n.id}`)} />
      ) : null}
      {mode === null && (editable || a.can_verify || a.can_self_verify) ? (
        <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap', marginTop: 4 }}>
          {editable && a.can_add_evidence && a.evidence_required !== 'none' ? <GhostButton testID={`action-evidence-add-${a.id}`} label={busy ? 'Yükleniyor…' : a.evidence_required === 'photo' ? 'Fotoğraf ekle' : 'Belge ekle'} height={34} size={11.5} disabled={busy} onPress={addEvidence} /> : null}
          {editable && (a.owner_id === me || n.permissions.manage) ? <GhostButton testID={`action-done-open-${a.id}`} label='"Yapıldı" bildir' height={34} size={11.5} disabled={needsEvidence} onPress={() => setMode('done')} /> : null}
          {editable && (n.permissions.manage || a.created_by === me) ? <GhostButton label="İptal et" height={34} size={11.5} color={C.crit} border={tint.crit(0.3)} onPress={() => setMode('cancel')} /> : null}
          {editable && n.permissions.manage ? <GhostButton label="Yeniden ata" height={34} size={11.5} onPress={() => setMode('reassign')} /> : null}
          {a.can_verify ? <GhostButton testID={`action-verify-open-${a.id}`} label={a.legacy_unverified ? 'Eski kaydı doğrula' : 'Sonucu doğrula'} height={34} size={11.5} color={C.lime} border={tint.lime(0.35)} onPress={() => setMode('verify')} /> : null}
          {!a.can_verify && a.can_self_verify ? <GhostButton testID={`action-self-verify-open-${a.id}`} label="Öz doğrulama yap" height={34} size={11.5} color={C.warn} border={tint.warn(0.35)} onPress={() => setMode('verify')} /> : null}
        </View>
      ) : null}
      {editable && needsEvidence && mode === null ? <Text style={type(11, 400, { color: C.t3 })}>"Yapıldı" bildirmek için önce {EV_LABEL[a.evidence_required]} kanıtını ekle.</Text> : null}
      {mode ? (
        <View style={{ gap: 8, marginTop: 4 }}>
          {mode === 'reassign' ? <PersonChips siteId={n.site_id} value={owner} onChange={setOwner} /> : (
            <Field label={mode === 'done' ? 'Ne yapıldı' : mode === 'verify' ? (verifySelf ? 'Öz doğrulama gerekçesi (en az 20 karakter: neye baktın, neden başkası doğrulamıyor)' : 'Neyi kontrol ettin') : 'İptal gerekçesi'}
              testID={`action-notes-${a.id}`} value={notes} onChangeText={setNotes} multiline />
          )}
          {mode === 'done' && n.permissions.manage ? (
            <>
              <Text style={type(12, 600, { color: C.t2 })}>İşi kim yaptı? (boş: sen)</Text>
              <PersonChips siteId={n.site_id} value={doer} onChange={setDoer} />
            </>
          ) : null}
          {mode === 'done' ? <Text style={type(11, 400, { color: C.t3, lh: 1.45 })}>Bu bir beyandır; doğrulanana kadar akışta sonuç sayılmaz. Sorumlu, işi yapan, beyan eden ve kanıt veren ayrı kaydedilir.</Text> : null}
          {verifySelf ? (
            <Tap testID={`action-self-confirm-${a.id}`} onPress={() => setSelfConfirm(x => !x)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <View style={{ width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: selfConfirm ? C.warn : C.t3, backgroundColor: selfConfirm ? C.warn : 'transparent' }} />
              <Text style={[type(12, 500, { lh: 1.4 }), { flex: 1 }]}>Bu işte payım var; bunu öz doğrulama olarak kaydet (etiketlenir, geçmişte görünür).</Text>
            </Tap>
          ) : null}
          {error ? <ErrorBox message={error} /> : null}
          {mode === 'verify' ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <PrimaryButton testID={`action-verify-ok-${a.id}`} label={busy ? 'Kaydediliyor…' : verifySelf ? 'Öz doğrulama ile onayla' : 'Doğrulandı'} glow={false} height={40} size={12.5} style={{ flex: 1 }}
                disabled={busy || notes.trim().length < minNotes || (verifySelf && !selfConfirm)}
                onPress={() => run(() => post(`${base}/actions/${a.id}`, { op: 'verify', result: 'accepted', notes: notes.trim(), selfVerify: verifySelf }),
                  verifySelf ? 'Öz doğrulama kaydedildi' : 'Aksiyon sonucu doğrulandı', verifySelf ? 'Etiketli: öz doğrulama.' : undefined)} />
              <GhostButton testID={`action-verify-reject-${a.id}`} label="Reddet" height={40} size={12.5} color={C.crit} border={tint.crit(0.3)} disabled={busy || notes.trim().length < 10}
                onPress={() => run(() => post(`${base}/actions/${a.id}`, { op: 'verify', result: 'rejected', notes: notes.trim(), selfVerify: verifySelf }), 'Beyan reddedildi', 'Aksiyon yeniden açık; sorumluya bildirim gitti.')} />
              <GhostButton label="Vazgeç" height={40} size={12.5} onPress={() => setMode(null)} />
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <PrimaryButton testID={`action-confirm-${a.id}`} label={busy ? 'Kaydediliyor…' : mode === 'done' ? '"Yapıldı" bildir' : mode === 'cancel' ? 'İptal et' : 'Ata'} glow={false} height={40} size={12.5} style={{ flex: 1 }}
                disabled={busy || (mode === 'reassign' ? !owner : notes.trim().length < 5)}
                onPress={() => run(() => post(`${base}/actions/${a.id}`, mode === 'reassign' ? { op: 'reassign', ownerId: owner } : mode === 'done' ? { op: 'done', notes: notes.trim(), performedBy: doer } : { op: mode, notes: notes.trim() }),
                  mode === 'done' ? '"Yapıldı" bildirildi' : mode === 'cancel' ? 'Aksiyon iptal edildi' : 'Aksiyon yeniden atandı', mode === 'done' ? 'Yetkili doğrulayınca sonuç sayılır.' : undefined)} />
              <GhostButton label="Vazgeç" height={40} size={12.5} onPress={() => setMode(null)} />
            </View>
          )}
        </View>
      ) : null}
      {mode === null && error ? <ErrorBox message={error} /> : null}
    </View>
  );
}

export function VerificationCard({ n, base, reload }: { n: NcrDetail; base: string; reload: () => void }) {
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [selfConfirm, setSelfConfirm] = useState(false);
  const { busy, error, run, post } = useRun(() => { setNotes(''); setReason(''); setSelfConfirm(false); reload(); });
  const last = [...n.verifications].reverse().find(v => v.result === 'effective');
  if (n.status === 'closed') {
    return (
      <Card border={tint.lime(0.3)} radius={22} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 8 }}>
        <Eyebrow color={C.lime}>KAPALI</Eyebrow>
        <Text style={type(12.5, 400, { color: C.t2, lh: 1.45 })}>{n.closed_at ? `Doğrulanıp kapatıldı · ${fmtDateTime(n.closed_at)}` : 'Kapatıldı'}
          {last ? ` · ${last.verified_by_name}${last.verification_mode === 'self' ? ' · ÖZ DOĞRULAMA' : last.verified_via === 'grant' ? ' · dış doğrulayıcı' : ''}` : ''}</Text>
        {n.permissions.reopen ? (
          <>
            <Field label="Yeniden açma gerekçesi" testID="ncr-reopen-reason" value={reason} onChangeText={setReason} multiline placeholder="ör. Sabah ölçümü yine limit dışı" />
            {error ? <ErrorBox message={error} /> : null}
            <GhostButton testID="ncr-reopen" label={busy ? 'Açılıyor…' : 'Yeniden aç'} height={42} size={12.5} color={C.warn} border={tint.warn(0.35)} disabled={busy || reason.trim().length < 10}
              onPress={() => run(() => post(base + '/reopen', { reason: reason.trim() }), 'Kayıt yeniden açıldı', 'Yeni tur: aksiyon, etkinlik kontrolü ve doğrulama gerekir.')} />
          </>
        ) : null}
      </Card>
    );
  }
  if (n.status !== 'awaiting_verification') return null;
  return (
    <Card border={tint.lime(0.3)} radius={22} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 8 }}>
      <Eyebrow color={C.lime}>DOĞRULAMA</Eyebrow>
      <Text style={type(12.5, 400, { color: C.t2, lh: 1.5 })}>Etkinlik kontrolü kaydedildi. Yetkili, önlemin işe yarayıp yaramadığını doğrular. Etkili değilse kayıt açık kalır ve yeni bir tur başlar.</Text>
      <Text testID="ncr-verification-policy" style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>{n.verificationPolicy}</Text>
      {n.permissions.verifyBlockedReason ? <Callout tone="warn" body={n.permissions.verifyBlockedReason} /> : null}
      {!n.permissions.verify && !n.permissions.selfVerify && n.permissions.verifyBlockedReason && n.permissions.inviteVerifier ? (
        <GhostButton testID="ncr-invite-verifier" label="Dış doğrulayıcı davet et" height={40} size={12.5} style={{ alignSelf: 'flex-start' }} onPress={() => router.push(`/verifiers?ncrId=${n.id}`)} />
      ) : null}
      {n.permissions.verify || n.permissions.selfVerify ? (
        <>
          <Field label={n.permissions.selfVerify ? 'Öz doğrulama gerekçesi (en az 20 karakter)' : 'Neyi kontrol ettin (ölçüm, belge, gözlem)'} testID="ncr-verify-notes" value={notes} onChangeText={setNotes} multiline />
          {n.permissions.selfVerify ? (
            <Tap testID="ncr-self-confirm" onPress={() => setSelfConfirm(x => !x)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <View style={{ width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: selfConfirm ? C.warn : C.t3, backgroundColor: selfConfirm ? C.warn : 'transparent' }} />
              <Text style={[type(12, 500, { lh: 1.4 }), { flex: 1 }]}>Bu turun düzeltmesinde payım var; kapanışı öz doğrulama olarak kaydet.</Text>
            </Tap>
          ) : null}
          {error ? <ErrorBox message={error} /> : null}
          <PrimaryButton testID="ncr-verify-ok" label={busy ? 'Kaydediliyor…' : n.permissions.selfVerify ? 'Etkili · öz doğrulama ile kapat' : 'Etkili · doğrula ve kapat'} height={46} size={13.5}
            disabled={busy || notes.trim().length < (n.permissions.selfVerify ? 20 : 5) || (n.permissions.selfVerify && !selfConfirm)}
            onPress={() => run(() => post(base + '/verify', { result: 'effective', notes: notes.trim(), selfVerify: n.permissions.selfVerify }), 'Doğrulandı ve kapatıldı', n.permissions.selfVerify ? 'Etiketli: öz doğrulama.' : undefined)} />
          <GhostButton testID="ncr-verify-fail" label="Etkili değil · açık kalsın" height={42} size={12.5} color={C.crit} border={tint.crit(0.35)} disabled={busy || notes.trim().length < 10}
            onPress={() => run(() => post(base + '/verify', { result: 'not_effective', notes: notes.trim() }), 'Kayıt açık kaldı', 'Sorumluya bildirildi; yeni aksiyon gerekiyor.')} />
        </>
      ) : !n.permissions.verifyBlockedReason ? <Text style={type(12, 500, { color: C.warn })}>Yetkili doğrulaması bekleniyor.</Text> : null}
    </Card>
  );
}

export function HistoryCard({ n }: { n: NcrDetail }) {
  const [all, setAll] = useState(false);
  const rows = all ? n.history : n.history.slice(-6);
  return (
    <Card radius={22} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 8 }}>
      <Eyebrow>GEÇMİŞ</Eyebrow>
      {rows.map((h, i) => (
        <View key={i} style={{ gap: 1 }}>
          <Text style={type(12.5, 500, { lh: 1.4 })}>{historyLine(h)}</Text>
          <Text style={type(11, 400, { color: C.t3 })}>{h.actor_name ?? 'Sistem'} · {fmtDateTime(h.occurred_at)}</Text>
        </View>
      ))}
      {n.history.length > 6 ? <GhostButton label={all ? 'Son kayıtlar' : `Tümü (${n.history.length})`} height={34} size={11.5} style={{ alignSelf: 'flex-start' }} onPress={() => setAll(v => !v)} /> : null}
    </Card>
  );
}

const TSTATE = (st: TrainingRow['state']) => st.cancelled ? ['İPTAL', C.t3] : st.fieldVerified === 'effective' ? ['SAHADA ETKİLİ', C.lime]
  : st.fieldVerified === 'not_effective' ? ['SAHADA ETKİLİ DEĞİL', C.crit] : st.completed ? ['TAMAMLANDI · SAHA DOĞRULAMASI BEKLİYOR', C.warn]
  : st.passed ? ['SINAVI GEÇTİ', C.info] : st.read ? ['OKUNDU', C.info] : st.overdue ? ['GECİKMİŞ', C.crit] : ['ATANDI', C.t2];
export type TrainingRow = { id: string; title: string; userName: string; dueAt: string | null; reason: string; isExample: boolean; bestScore: number | null; questions: number;
  state: { read: boolean; completed: boolean; passed: boolean | null; fieldVerified: 'effective' | 'not_effective' | null; cancelled: boolean; overdue: boolean } };
export const trainingStateLabel = TSTATE;

/** Training for this case: each fact separate; none of them closes the case. */
export function TrainingCard({ n }: { n: NcrDetail }) {
  if (!n.trainings.length && !(n.permissions.manage && n.relatedTraining.length && n.status !== 'closed')) return null;
  return (
    <Card radius={22} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 9 }}>
      <Eyebrow>EĞİTİM</Eyebrow>
      <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Okundu, tamamlandı, sınavı geçti ve sahada etkinliği doğrulandı ayrı kaydedilir. Eğitimin tamamlanması bu kaydı kapatmaz.</Text>
      {n.trainings.map(t => {
        const [label, color] = TSTATE(t.state);
        return (
          <Tap key={t.id} testID={`ncr-training-${t.id}`} onPress={() => router.push(`/training/a/${t.id}`)} style={{ borderWidth: 1, borderColor: C.bd, borderRadius: 16, padding: 12, gap: 4 }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Text style={[type(13, 600), { flex: 1 }]}>{t.title}</Text>
              <Text style={type(10, 700, { ls: 0.08, color: color as string })}>{label}</Text>
            </View>
            <Text style={type(11.5, 400, { color: C.t3 })}>{t.userName}{t.dueAt ? ` · termin ${fmtDateTime(t.dueAt)}` : ''}{t.isExample ? ' · ÖRNEK İÇERİK' : ''}</Text>
          </Tap>
        );
      })}
      {n.permissions.manage && n.status !== 'closed' ? (
        <GhostButton testID="ncr-training-assign" label="Eğitim ata" height={38} size={12} style={{ alignSelf: 'flex-start' }} onPress={() => router.push(`/training/assign?ncrId=${n.id}`)} />
      ) : null}
    </Card>
  );
}
