import { useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { useSession } from '../../api/session';
import { useApi } from '../../api/useApi';
import { Screen } from '../../components/Screen';
import { ErrorBox, ExampleBadge, Loading } from '../../components/states';
import { Card, Eyebrow, Pill } from '../../components/ui';
import { fmtDateTime } from '../../features/dates';
import { C, tint, type } from '../../theme';
import { DECISION } from '../obligations';

type Explanation = {
  obligation: { id: string; decision: keyof typeof DECISION; reason: string; decidedBy: string; decidedAt: string; missingFacts: string[] };
  rule: { code: string; version: number; status: string; kind: string; isExample: boolean; title: string; summary: string; effectiveFrom: string; ambiguityNote: string | null; label: string };
  provisions: { ref: string; excerpt: string; version_label: string; source_title: string; issuer: string; is_example: boolean }[];
  matchedFacts: Record<string, { value: unknown; source: string; verification: string; recordedAt: string } | null>;
  history: { id: string; decision: string; decided_by: string; decided_at: string }[];
};

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
            <Text style={[type(12.5, 400, { color: C.t2 }), { marginTop: 10 }]}>{e.rule.code} · sürüm {e.rule.version} · {e.rule.status} · yürürlük {e.rule.effectiveFrom}</Text>
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
