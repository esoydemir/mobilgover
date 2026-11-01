import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { errorText } from '../../api/client';
import { Text, View } from 'react-native';
import { useSession } from '../../api/session';
import { useApi } from '../../api/useApi';
import { Screen } from '../../components/Screen';
import { ErrorBox, ExampleBadge, Field, Loading } from '../../components/states';
import { Card, Eyebrow, GhostButton, Pill, PrimaryButton } from '../../components/ui';
import { useUi } from '../../state/app';
import { fmtDateTime } from '../../features/dates';
import { C, tint, type } from '../../theme';
import { DECISION } from '../obligations';

type Explanation = {
  obligation: { id: string; decision: keyof typeof DECISION; reason: string; decidedBy: string; decidedByName: string | null; decidedAt: string; missingFacts: string[];
    isCurrent: boolean; currentId: string; manual: boolean; canOverride: boolean };
  rule: { code: string; version: number; status: string; kind: string; isExample: boolean; title: string; summary: string; effectiveFrom: string; ambiguityNote: string | null; label: string };
  provisions: { ref: string; excerpt: string; version_label: string; source_title: string; issuer: string; is_example: boolean }[];
  matchedFacts: Record<string, { value: unknown; source: string; verification: string; recordedAt: string } | null>;
  history: { id: string; decision: string; decided_by: string; decided_at: string }[];
};

const RULE_STATUS: Record<string, string> = { draft: 'taslak', in_review: 'incelemede', approved: 'onaylı', published: 'yayında', retired: 'yürürlükten kalktı' };
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
          <Text style={type(14, 400, { lh: 1.5, color: C.t2 })}>{e.obligation.reason}</Text>
          {!e.obligation.isCurrent ? (
            <View style={{ borderWidth: 1, borderColor: tint.warn(0.3), backgroundColor: tint.warn(0.06), borderRadius: 16, padding: 13, gap: 8 }}>
              <Text style={type(12.5, 500, { color: C.warn, lh: 1.45 })}>Bu, geçmişte verilmiş bir karar. Şu an geçerli olan karar farklı.</Text>
              <GhostButton label="Güncel kararı aç" height={36} size={12} onPress={() => router.replace(`/obligation/${e.obligation.currentId}`)} style={{ alignSelf: 'flex-start' }} />
            </View>
          ) : e.obligation.canOverride ? <DecisionCard e={e} onDone={newId => (newId === id ? q.reload() : router.replace(`/obligation/${newId}`))} /> : null}
          <View style={{ borderWidth: 1, borderColor: e.rule.isExample ? tint.warn(0.3) : C.bd, borderRadius: 16, padding: 13 }}>
            <Text style={type(12.5, 600, { color: e.rule.isExample ? C.warn : C.t1 })}>{e.rule.label}</Text>
          </View>
          <Card>
            <Eyebrow>EŞLEŞEN İŞLETME BİLGİLERİ</Eyebrow>
            <View style={{ gap: 9, marginTop: 12 }}>
              {Object.entries(e.matchedFacts).map(([k, f]) => (
                <View key={k} style={{ flexDirection: 'row', gap: 10 }}>
                  <Text style={[type(12.5, 600), { flex: 1 }]}>{k}</Text>
                  <Text style={type(12.5, 500, { color: f ? C.t1 : C.warn })}>{f ? `${fmt(f.value)} · ${f.verification === 'expert_verified' ? 'uzman doğruladı' : f.source === 'ocr' && f.verification === 'unverified' ? 'OCR, onaysız' : 'beyan'}` : 'bilinmiyor'}</Text>
                </View>
              ))}
            </View>
            {e.obligation.missingFacts.length ? <Text style={[type(12, 500, { color: C.warn }), { marginTop: 10 }]}>Eksik bilgi: {e.obligation.missingFacts.join(', ')}. Eksik bilgi "uygulanmaz" sayılmaz.</Text> : null}
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/companies/${company!.id}/obligations/${e.obligation.id}`;
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
          <Eyebrow color={C.warn}>UYGULANMAZ KARARI</Eyebrow>
          <Text style={type(12, 400, { color: C.t2, lh: 1.5 })}>Bu yükümlülüğün açık kontrolleri iptal edilir ve yenileri oluşmaz. Karar adınla ve gerekçesiyle kayda geçer; denetim dosyasında görünür. İstediğin zaman geri alabilirsin.</Text>
          <Field label="Gerekçe (en az bir cümle)" testID="override-reason" value={reason} onChangeText={setReason} multiline placeholder="ör. Mutfakta hazırlık yapılmıyor; yalnızca paketli ürün satılıyor." />
          {error ? <ErrorBox message={error} /> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <PrimaryButton testID="override-save" label={busy ? 'Kaydediliyor…' : 'Uygulanmaz olarak kaydet'} disabled={busy || reason.trim().length < 10} height={44} size={12.5} glow={false} style={{ flex: 1 }}
              onPress={() => run(async () => {
                const r = await call<{ id: string }>('POST', `${base}/not-applicable`, { reason: reason.trim() });
                showToast('Uygulanmaz olarak kaydedildi', 'Açık kontroller iptal edildi.');
                onDone(r.id);
              })} />
            <GhostButton label="Vazgeç" height={44} size={12.5} onPress={() => { setOpen(false); setError(null); }} />
          </View>
        </>
      )}
    </Card>
  );
}
