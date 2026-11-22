import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import { Screen } from '../components/Screen';
import { ErrorBox, Field } from '../components/states';
import { Card, Eyebrow, Pill, PrimaryButton, Tap, shortWhy } from '../components/ui';
import { C, tint, type } from '../theme';

type Src = { n: number; kind: string; title: string; locator?: string; text: string; route: string | null; isExample: boolean; verifiedLaw: boolean; cited?: boolean };
type Answer = { question: string; outcome: 'answered' | 'insufficient' | 'conflict' | 'fine_declined'; mode?: 'model' | 'sources_only'; model?: { status: string; name: string | null }; answer: string; sources: Src[]; notes: string[] };
const KIND: Record<string, string> = { obligation: 'Yükümlülük', provision: 'Madde', document: 'Belge', task: 'Görev' };

/** Source-bound assistant: lines are quotes from this business's own records, or an honest "not enough source". */
export default function AssistantRoute() {
  const { company, call } = useSession();
  const [q, setQ] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [a, setA] = useState<Answer | null>(null);
  const ask = async () => {
    setBusy(true); setError(null);
    try { setA(await call<Answer>('POST', `/companies/${company!.id}/assistant/ask`, { question: q })); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <Screen title="Kaynaklı asistan" titleEn="Assistant">
      <Card style={{ gap: 8 }}>
        <Eyebrow>SORU</Eyebrow>
        <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Yanıt yalnız işletmenin belge, görev ve yayımlanmış yükümlülüklerinden gelir; kaynak yoksa söylenir. Ceza tutarı hesaplanmaz. Örnek kurallar doğrulanmış mevzuat gibi sunulmaz.</Text>
        <Field label="Sorun" testID="assistant-q" value={q} onChangeText={setQ} multiline />
        <PrimaryButton testID="assistant-ask" label={busy ? 'Aranıyor…' : 'Sor'} disabled={busy || q.trim().length < 5} why={shortWhy(q, 5, 'Soru')} onPress={ask} />
        {error ? <ErrorBox message={error} /> : null}
      </Card>
      {a ? (
        <Card style={{ gap: 8 }}>
          <View testID="assistant-outcome"><Pill label={a.outcome === 'answered' ? 'KAYNAKLI YANIT' : a.outcome === 'conflict' ? 'KAYNAKLAR ÇELİŞİYOR' : a.outcome === 'fine_declined' ? 'KAPSAM DIŞI' : 'YETERSİZ KAYNAK'} fg={a.outcome === 'answered' ? C.lime : C.warn} bg={a.outcome === 'answered' ? tint.lime(0.14) : tint.warn(0.14)} /></View>
          <Text testID="assistant-mode" style={type(11, 500, { color: C.t3 })}>{a.mode === 'model' ? `Yanıtı dil modeli yazdı (${a.model?.name ?? 'model'}); kaynaklar aşağıda.` : a.model?.status === 'not_configured' || !a.model ? 'Yanıt kaynaklardan olduğu gibi aktarıldı (dil modeli bağlı değil).' : 'Dil modeli kullanılamadı; kaynaklar olduğu gibi listelendi.'}</Text>
          <Text testID="assistant-answer" style={type(12.5, 400, { lh: 1.5 })}>{a.answer}</Text>
          {a.sources.map(s => (
            <Tap key={s.n} testID={`assistant-source-${s.n}`} disabled={!s.route} onPress={() => s.route && router.push(s.route as Href)} style={{ borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 6, gap: 2 }}>
              <Text style={type(12, 600, { color: s.route ? C.info : C.t1 })}>[{s.n}] {KIND[s.kind] ?? s.kind}: {s.title}{s.isExample ? ' · ÖRNEK KURAL' : ''}{s.cited ? ' · yanıtta kullanıldı' : ''}</Text>
              {s.locator ? <Text style={type(11, 400, { color: C.t3 })}>{s.locator}</Text> : null}
            </Tap>
          ))}
          {a.notes.map((n, i) => <Text key={i} style={type(11.5, 400, { color: C.warn, lh: 1.4 })}>{n}</Text>)}
        </Card>
      ) : null}
    </Screen>
  );
}
