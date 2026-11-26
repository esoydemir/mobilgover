import { router, useLocalSearchParams } from 'expo-router';
import { factLabels } from '../../features/factLabels';
import { useState } from 'react';
import { errorText } from '../../api/client';
import { Text, View } from 'react-native';
import { useSession } from '../../api/session';
import { useApi } from '../../api/useApi';
import { Screen } from '../../components/Screen';
import { ErrorBox, ExampleBadge, Field, Loading } from '../../components/states';
import { Card, Eyebrow, FilterChip, GhostButton, Pill, PrimaryButton, shortWhy } from '../../components/ui';
import { useUi } from '../../state/app';
import { fmtDateTime } from '../../features/dates';
import { C, tint, type } from '../../theme';
import { DECISION } from '../obligations';

type Explanation = {
  obligation: { id: string; siteName?: string | null; decision: keyof typeof DECISION; reason: string; decidedBy: string; decidedByName: string | null; decidedAt: string; missingFacts: string[];
    isCurrent: boolean; currentId: string; manual: boolean; canOverride: boolean; mandatory: boolean };
  pendingReview: { id: string; reason: string; basis: string | null; disputedFacts: { key: string; proposed: unknown }[] | null; requestedByName: string; requestedAt: string; canReview: boolean } | null;
  conditionFacts: { key: string; label: string; type: 'boolean' | 'number' | 'string' | 'string[]'; current: unknown; source: string | null; verification: string | null }[];
  reviews: { id: string; status: string; reason: string; basis: string | null; engine_outcome: string | null; requested_at: string; reviewed_at: string | null; review_notes: string | null; requested_by_name: string; reviewed_by_name: string | null }[];
  rule: { code: string; version: number; status: string; kind: string; isExample: boolean; title: string; summary: string; effectiveFrom: string; ambiguityNote: string | null; label: string };
  provisions: { ref: string; excerpt: string; version_label: string; source_title: string; issuer: string; is_example: boolean }[];
  matchedFacts: Record<string, { value: unknown; source: string; verification: string; recordedAt: string } | null>;
  factOrigins?: Record<string, { sourceRef: string | null; note: string | null }>;
  reasonText?: string;
  reviewStatus?: { state: 'in_review' | 'needs_info' | 'none'; text: string | null };
  definition?: { label: string; appliesWhen: string[]; notApplicableWhen: string; effectiveFrom: string; effectiveTo: string | null; responsibleRole: string | null; checks: { code: string; title: string; frequency: string; evidence: string[] }[] };
  history: { id: string; decision: string; decided_by: string; decided_at: string }[];
};

const RULE_STATUS: Record<string, string> = { draft: 'taslak', in_review: 'incelemede', approved: 'onaylı', published: 'yayında', retired: 'yürürlükten kalktı', rejected: 'reddedildi', withdrawn: 'geri çekildi' };
const fmt = (v: unknown) => (v === true ? 'Evet' : v === false ? 'Hayır' : Array.isArray(v) ? v.join(', ') : v === null || v === undefined ? '—' : String(v));

/** "Why does this apply to me?" — matched facts, source provision, rule version. */
export default function ObligationRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { company } = useSession();
  const q = useApi<Explanation>(company ? `/companies/${company.id}/obligations/${id}/explanation` : null);
  const e = q.data;
  return (
    <Screen title="Neden bana uygulanıyor?" titleEn="Why does this apply?">
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {!e ? <Loading /> : (
        <>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Pill label={DECISION[e.obligation.decision][0]} fg={DECISION[e.obligation.decision][1]} bg={DECISION[e.obligation.decision][2]} />
            {e.rule.isExample ? <ExampleBadge /> : null}
          </View>
          <Text style={type(23, 600, { family: 'outfit', ls: -0.03, lh: 1.15 })}>{e.rule.title}</Text>
          {e.obligation.siteName ? <Text testID="obl-detail-site" style={type(13, 600, { color: C.t2 })}>Şube: {e.obligation.siteName}</Text> : null}
          <Text style={type(14, 400, { lh: 1.5, color: C.t2 })}>{e.obligation.reason}</Text>
          {!e.obligation.isCurrent ? (
            <View style={{ borderWidth: 1, borderColor: tint.warn(0.3), backgroundColor: tint.warn(0.06), borderRadius: 16, padding: 13, gap: 8 }}>
              <Text style={type(12.5, 500, { color: C.warn, lh: 1.45 })}>Bu, geçmişte verilmiş bir karar. Şu an geçerli olan karar farklı.</Text>
              <GhostButton label="Güncel kararı aç" height={36} size={12} onPress={() => router.replace(`/obligation/${e.obligation.currentId}`)} style={{ alignSelf: 'flex-start' }} />
            </View>
          ) : e.pendingReview ? <ReviewCard e={e} onDone={newId => (newId === id ? q.reload() : router.replace(`/obligation/${newId}`))} />
            : e.obligation.canOverride ? <DecisionCard e={e} onDone={newId => (newId === id ? q.reload() : router.replace(`/obligation/${newId}`))} /> : null}
          {e.reviews.filter(r => r.status !== 'pending').length ? (
            <Card radius={22} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 8 }}>
              <Eyebrow>"UYGULANMAZ" İNCELEMELERİ</Eyebrow>
              {e.reviews.filter(r => r.status !== 'pending').map(r => (
                <View key={r.id} style={{ gap: 2 }}>
                  <Text style={type(12.5, 600, { color: r.status === 'approved' ? C.warn : r.status === 'rejected' ? C.lime : C.t2 })}>
                    {r.status === 'approved' ? 'Onaylandı' : r.status === 'rejected' ? 'Reddedildi · yükümlülük sürüyor' : 'Geri çekildi'}
                  </Text>
                  <Text style={type(11.5, 400, { color: C.t2, lh: 1.45 })}>İstek: {r.reason} ({r.requested_by_name}, {fmtDateTime(r.requested_at)})</Text>
                  {r.basis ? <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Dayanak: {r.basis}</Text> : null}
                  {r.engine_outcome ? <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Doğrulanan bilgilerle kural motorunun kararı: {DECISION[r.engine_outcome as keyof typeof DECISION]?.[0] ?? r.engine_outcome}</Text> : null}
                  {r.review_notes ? <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>İnceleme: {r.review_notes} ({r.reviewed_by_name}{r.reviewed_at ? `, ${fmtDateTime(r.reviewed_at)}` : ''})</Text> : null}
                </View>
              ))}
            </Card>
          ) : null}
          <View style={{ borderWidth: 1, borderColor: e.rule.isExample ? tint.warn(0.3) : C.bd, borderRadius: 16, padding: 13 }}>
            <Text style={type(12.5, 600, { color: e.rule.isExample ? C.warn : C.t1 })}>{e.rule.label}</Text>
          </View>
          {e.reviewStatus?.text ? (
            <View testID="obligation-review-status" style={{ borderWidth: 1, borderColor: tint.warn(0.3), borderRadius: 16, padding: 13 }}>
              <Text style={type(12.5, 600, { color: C.warn, lh: 1.45 })}>{e.reviewStatus.text}</Text>
            </View>
          ) : null}
          {e.reasonText ? (
            <Card>
              <Eyebrow>NEDEN BU KARAR</Eyebrow>
              <Text testID="obligation-reason" style={type(13, 500, { color: C.t1, lh: 1.5 })}>{e.reasonText}</Text>
            </Card>
          ) : null}
          {e.definition ? (
            <Card>
              <Eyebrow>KURALIN TANIMI</Eyebrow>
              {e.definition.appliesWhen.map((c, i) => <Text key={i} style={type(12.5, 500, { color: C.t2, lh: 1.5 })}>• {c}</Text>)}
              <Text style={type(12, 400, { color: C.t3, lh: 1.45 })}>{e.definition.notApplicableWhen}</Text>
              {e.definition.checks.map(c => <Text key={c.code} style={type(12.5, 500, { color: C.t2, lh: 1.5 })}>{c.title} · {c.frequency}{c.evidence.length ? ` · kanıt: ${c.evidence.join(', ')}` : ''}</Text>)}
              <Text style={type(11.5, 400, { color: C.t3 })}>Yürürlük: {e.definition.effectiveFrom}{e.definition.effectiveTo ? ` – ${e.definition.effectiveTo}` : ''} · Sorumlu rol kuralda tanımlı değil; görevi yönetici atar.</Text>
            </Card>
          ) : null}
          <Card>
            <Eyebrow>EŞLEŞEN İŞLETME BİLGİLERİ</Eyebrow>
            <View style={{ gap: 9, marginTop: 12 }}>
              {Object.entries(e.matchedFacts).map(([k, f]) => (
                <View key={k} style={{ gap: 3 }}>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Text style={[type(12.5, 600), { flex: 1 }]}>{e.conditionFacts?.find(c => c.key === k)?.label ?? k}</Text>
                    <Text style={type(12.5, 500, { color: f ? C.t1 : C.warn })}>{f ? `${fmt(f.value)} · ${f.verification === 'expert_verified' ? 'uzman doğruladı' : f.source === 'ocr' && f.verification === 'unverified' ? 'OCR, onaysız' : 'beyan'}` : 'bilinmiyor'}</Text>
                  </View>
                  {e.factOrigins?.[k]?.note ? <Text style={type(11.5, 400, { color: C.t3, lh: 1.4 })}>{e.factOrigins[k]!.note}</Text> : null}
                </View>
              ))}
            </View>
            {e.obligation.missingFacts.length ? <Text style={[type(12, 500, { color: C.warn }), { marginTop: 10 }]}>Eksik bilgi: {factLabels(e.obligation.missingFacts)}. Eksik bilgi "uygulanmaz" sayılmaz.</Text> : null}
          </Card>
          <Card>
            <Eyebrow>KAYNAK HÜKÜM</Eyebrow>
            {e.provisions.length === 0 ? <Text style={[type(12.5, 400, { color: C.t2 }), { marginTop: 10 }]}>Bu bir iyi uygulama önerisi; bağlı bir mevzuat hükmü yok.</Text> : null}
            {e.provisions.map(p => (
              <View key={p.ref} style={{ marginTop: 10, gap: 4 }}>
                <Text style={type(13, 600)}>{p.source_title} · {p.ref}</Text>
                <Text style={type(11.5, 400, { color: C.t3 })}>{p.issuer} · sürüm {p.version_label}{p.is_example ? ' · ÖRNEK KAYNAK' : ''}</Text>
                <Text style={type(12.5, 400, { color: C.t2, lh: 1.5 })}>{p.excerpt}</Text>
              </View>
            ))}
          </Card>
          <Card>
            <Eyebrow>KURAL VE KARAR GEÇMİŞİ</Eyebrow>
            <Text style={[type(12.5, 400, { color: C.t2 }), { marginTop: 10 }]}>{e.rule.code} · sürüm {e.rule.version} · {RULE_STATUS[e.rule.status] ?? e.rule.status} · yürürlük {e.rule.effectiveFrom}</Text>
            {e.rule.ambiguityNote ? <Text style={[type(12, 500, { color: C.info }), { marginTop: 6 }]}>Yoruma açık: {e.rule.ambiguityNote}</Text> : null}
            {e.history.map(h => (
              <Text key={h.id} style={[type(11.5, 400, { color: C.t3 }), { marginTop: 6 }]}>{fmtDateTime(h.decided_at)} · {DECISION[h.decision as keyof typeof DECISION]?.[0] ?? h.decision} · {h.decided_by === 'engine' ? 'kural motoru' : 'yetkili kişi'}</Text>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

/**
 * Owner / HQ manager: mark as "does not apply" with a reason, or withdraw such a
 * manual decision so the rule engine decides again. Both are recorded with the name.
 */
function DecisionCard({ e, onDone }: { e: Explanation; onDone: (newId: string) => void }) {
  const { company, call } = useSession();
  const { showToast } = useUi();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [basis, setBasis] = useState('');
  const [proposed, setProposed] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/companies/${company!.id}/obligations/${e.obligation.id}`;
  const disputed = Object.entries(proposed).flatMap(([key, raw]) => {
    const f = e.conditionFacts.find(x => x.key === key);
    if (!f || raw === '') return [];
    const value = f.type === 'boolean' ? raw === 'true' : f.type === 'number' ? Number(raw) : f.type === 'string[]' ? raw.split(',').map(x => x.trim()).filter(Boolean) : raw.trim();
    return f.type === 'number' && !Number.isFinite(value) ? [] : [{ key, proposed: value }];
  });
  const mandatoryReady = !e.obligation.mandatory || (disputed.length > 0 && basis.trim().length >= 10);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (x) { setError(errorText(x)); } finally { setBusy(false); }
  };

  if (e.obligation.manual && e.obligation.decision === 'not_applicable') {
    return (
      <Card radius={22} border={tint.warn(0.3)} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 8 }}>
        <Eyebrow color={C.warn}>ELLE VERİLMİŞ KARAR</Eyebrow>
        <Text style={type(12.5, 500, { lh: 1.5 })}>{e.obligation.decidedByName ?? 'Yetkili kişi'} · {fmtDateTime(e.obligation.decidedAt)}</Text>
        <Text style={type(12, 400, { color: C.t2, lh: 1.5 })}>Geri alınırsa kural motoru güncel işletme bilgilerine göre yeniden karar verir; uygulanıyorsa kontroller yeniden oluşturulur.</Text>
        {error ? <ErrorBox message={error} /> : null}
        {!open ? <GhostButton testID="override-withdraw-open" label="Kararı geri al" height={40} size={12.5} onPress={() => setOpen(true)} style={{ alignSelf: 'flex-start' }} /> : (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <PrimaryButton testID="override-withdraw" label={busy ? 'Geri alınıyor…' : 'Evet, geri al'} disabled={busy} height={42} size={12.5} glow={false} style={{ flex: 1 }}
              onPress={() => run(async () => {
                const r = await call<{ id: string; decision: string; createdTasks: number }>('POST', `${base}/withdraw-override`, {});
                showToast('Karar geri alındı', `${DECISION[r.decision as keyof typeof DECISION]?.[0] ?? r.decision}${r.createdTasks ? ` · ${r.createdTasks} kontrol oluşturuldu` : ''}`);
                onDone(r.id);
              })} />
            <GhostButton label="Vazgeç" height={42} size={12.5} onPress={() => setOpen(false)} />
          </View>
        )}
      </Card>
    );
  }
  if (e.obligation.decision === 'not_applicable') return null;
  return (
    <Card radius={22} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 10 }}>
      {!open ? (
        <>
          <Text style={type(13, 600)}>Bu yükümlülük işletmene uymuyor mu?</Text>
          <Text style={type(12, 400, { color: C.t2, lh: 1.5 })}>Önce profil yanıtlarını kontrol et; yanlış bir yanıt düzeltilince karar kendiliğinden değişir. Yanıtlar doğruysa gerekçeyle "uygulanmaz" diyebilirsin.</Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <GhostButton label="Profil yanıtları" height={38} size={12} onPress={() => router.push('/profile')} />
            <GhostButton testID="override-open" label="Uygulanmaz de" height={38} size={12} color={C.warn} border={tint.warn(0.35)} onPress={() => setOpen(true)} />
          </View>
        </>
      ) : (
        <>
          <Eyebrow color={C.warn}>{e.obligation.mandatory ? 'UYGULANMAZ İSTEĞİ · İNCELEMEYE GİDER' : 'UYGULANMAZ KARARI'}</Eyebrow>
          <Text style={type(12, 400, { color: C.t2, lh: 1.5 })}>{e.obligation.mandatory
            ? 'Bu zorunlu bir yükümlülük; karar hemen uygulanmaz. İsteğin başka bir yetkili ya da yetkilendirilmiş uzman tarafından incelenir. İnceleme bitene kadar kontroller sürer. Onaylanırsa ileriye dönük kontroller iptal edilir; saati geçmiş kontroller "kaçırıldı" olarak kayıtlarda kalır.'
            : 'Bu yükümlülüğün ileriye dönük açık kontrolleri iptal edilir ve yenileri oluşmaz; saati geçmiş kontroller "kaçırıldı" olarak kayıtlarda kalır. Karar adınla ve gerekçesiyle kayda geçer; denetim dosyasında görünür. İstediğin zaman geri alabilirsin.'}</Text>
          {e.obligation.mandatory ? (
            <View style={{ gap: 10 }}>
              <Text style={type(12.5, 600)}>Kuralın hangi koşulu sizin için doğru değil?</Text>
              <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>İki kişinin onayı tek başına yetmez. Seçtiğin bilgiler inceleyen tarafından doğrulanır, işletme profiline işlenir ve kararı kural motoru yeniden verir. Bilgiler kurala hâlâ uyuyorsa yükümlülük sürer.</Text>
              {e.conditionFacts.map(f => {
                const v = proposed[f.key];
                const on = v !== undefined;
                return (
                  <View key={f.key} style={{ borderWidth: 1, borderColor: on ? tint.warn(0.35) : C.bd, borderRadius: 14, padding: 11, gap: 7 }}>
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                      <Text style={[type(12.5, 600), { flex: 1 }]}>{f.label}</Text>
                      <Text style={type(11.5, 500, { color: C.t2 })}>Şu an: {fmt(f.current)}</Text>
                    </View>
                    {!on ? <GhostButton testID={`dispute-${f.key}`} label="Bu bilgi bizde farklı" height={32} size={11.5} style={{ alignSelf: 'flex-start' }}
                      onPress={() => setProposed(p => ({ ...p, [f.key]: f.type === 'boolean' ? String(!(f.current === true)) : '' }))} /> : (
                      <>
                        {f.type === 'boolean' ? (
                          <View style={{ flexDirection: 'row', gap: 7 }}>
                            <FilterChip testID={`dispute-${f.key}-true`} label="Doğrusu: Evet" px={12} active={v === 'true'} onPress={() => setProposed(p => ({ ...p, [f.key]: 'true' }))} />
                            <FilterChip testID={`dispute-${f.key}-false`} label="Doğrusu: Hayır" px={12} active={v === 'false'} onPress={() => setProposed(p => ({ ...p, [f.key]: 'false' }))} />
                          </View>
                        ) : <Field label={f.type === 'string[]' ? 'Doğru değer (virgülle ayır)' : 'Doğru değer'} value={v} onChangeText={x => setProposed(p => ({ ...p, [f.key]: x }))} />}
                        <GhostButton label="Bu bilgiyi çıkar" height={30} size={11} style={{ alignSelf: 'flex-start' }} onPress={() => setProposed(p => { const n = { ...p }; delete n[f.key]; return n; })} />
                      </>
                    )}
                  </View>
                );
              })}
              <Field label="Dayanak (hangi belge, gözlem ya da kayıt gösteriyor?)" testID="override-basis" value={basis} onChangeText={setBasis} multiline placeholder="ör. Dolap içi fotoğrafları ve menü: soğukta gıda saklanmıyor." />
            </View>
          ) : null}
          <Field label="Gerekçe (en az bir cümle)" testID="override-reason" value={reason} onChangeText={setReason} multiline placeholder="ör. Mutfakta hazırlık yapılmıyor; yalnızca paketli ürün satılıyor." />
          {error ? <ErrorBox message={error} /> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <PrimaryButton testID="override-save" label={busy ? 'Kaydediliyor…' : e.obligation.mandatory ? 'İncelemeye gönder' : 'Uygulanmaz olarak kaydet'} disabled={busy || reason.trim().length < 10 || !mandatoryReady} height={44} size={12.5} glow={false} style={{ flex: 1 }}
              onPress={() => run(async () => {
                const r = await call<{ id: string; status: 'applied' | 'pending_review' }>('POST', `${base}/not-applicable`,
                  e.obligation.mandatory ? { reason: reason.trim(), basis: basis.trim(), disputedFacts: disputed } : { reason: reason.trim() });
                if (r.status === 'pending_review') showToast('İncelemeye gönderildi', 'İnceleyenlere bildirildi; kontroller sürüyor.');
                else showToast('Uygulanmaz olarak kaydedildi', 'İleriye dönük kontroller iptal edildi.');
                onDone(r.id);
              })} />
            <GhostButton label="Vazgeç" height={44} size={12.5} onPress={() => { setOpen(false); setError(null); }} />
          </View>
        </>
      )}
    </Card>
  );
}

/** A pending "does not apply" request on a mandatory obligation: reviewer decides, requester may withdraw. */
function ReviewCard({ e, onDone }: { e: Explanation; onDone: (newId: string) => void }) {
  const { company, call } = useSession();
  const { showToast } = useUi();
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = e.pendingReview!;
  const base = `/companies/${company!.id}/override-requests/${r.id}`;
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (x) { setError(errorText(x)); } finally { setBusy(false); }
  };
  return (
    <Card radius={22} border={tint.warn(0.3)} style={{ paddingVertical: 15, paddingHorizontal: 16, gap: 8 }}>
      <Eyebrow color={C.warn}>"UYGULANMAZ" İSTEĞİ · İNCELEME BEKLİYOR</Eyebrow>
      <Text style={type(13, 500, { lh: 1.45 })}>{r.reason}</Text>
      <Text style={type(11, 400, { color: C.t3 })}>{r.requestedByName} · {fmtDateTime(r.requestedAt)}</Text>
      {r.disputedFacts?.length ? (
        <View style={{ gap: 5, borderWidth: 1, borderColor: C.bd, borderRadius: 14, padding: 11 }}>
          <Text style={type(10, 700, { ls: 0.08, color: C.t3 })}>İTİRAZ EDİLEN KOŞULLAR</Text>
          {r.disputedFacts.map(d => {
            const f = e.conditionFacts.find(x => x.key === d.key);
            return <Text key={d.key} style={type(12, 500, { lh: 1.45 })}>{f?.label ?? d.key}: şu an {fmt(f?.current)} → önerilen {fmt(d.proposed)}</Text>;
          })}
          {r.basis ? <Text style={type(11.5, 400, { color: C.t2, lh: 1.45 })}>Dayanak: {r.basis}</Text> : null}
        </View>
      ) : <Text style={type(11.5, 500, { color: C.warn, lh: 1.45 })}>Bu istek hangi koşulun sağlanmadığını belirtmiyor; onaylanamaz. Reddedip gerekçeli yeni istek açılmalı.</Text>}
      <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>İnceleme bitene kadar yükümlülük uygulanmaya ve kontroller oluşmaya devam eder. Onay, yukarıdaki bilgileri doğrulanmış olarak işletme profiline işler; kararı kural motoru verir.</Text>
      {error ? <ErrorBox message={error} /> : null}
      {r.canReview ? (
        <>
          <Field label="İnceleme notu (neye baktın?)" testID="review-notes" value={notes} onChangeText={setNotes} multiline />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <PrimaryButton testID="review-approve" label="Onayla" glow={false} height={42} size={12.5} style={{ flex: 1 }} disabled={busy || notes.trim().length < 5} why={shortWhy(notes, 5, 'Not')}
              onPress={() => run(async () => { const x = await call<{ obligationId: string }>('POST', `${base}/review`, { decision: 'approved', notes: notes.trim() }); showToast('Bilgiler doğrulandı', 'Kural motoru yeniden karar verdi: uygulanmaz.'); onDone(x.obligationId); })} />
            <GhostButton testID="review-reject" label="Reddet" height={42} size={12.5} color={C.crit} border={tint.crit(0.35)} disabled={busy || notes.trim().length < 5} why={shortWhy(notes, 5, 'Not')}
              onPress={() => run(async () => { await call('POST', `${base}/review`, { decision: 'rejected', notes: notes.trim() }); showToast('İstek reddedildi', 'Yükümlülük sürüyor.'); onDone(e.obligation.id); })} />
          </View>
        </>
      ) : e.obligation.canOverride ? (
        <>
          <Text style={type(11.5, 500, { color: C.t3 })}>Kendi isteğini inceleyemezsin; başka bir yetkili ya da uzman inceler.</Text>
          <GhostButton testID="review-withdraw" label="İsteği geri çek" height={38} size={12} style={{ alignSelf: 'flex-start' }} disabled={busy}
            onPress={() => run(async () => { await call('POST', `${base}/withdraw`, {}); showToast('İstek geri çekildi'); onDone(e.obligation.id); })} />
        </>
      ) : null}
    </Card>
  );
}
