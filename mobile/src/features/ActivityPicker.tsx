import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import { ErrorBox, Field } from '../components/states';
import { PrimaryButton, Tap } from '../components/ui';
import { C, tint, type } from '../theme';

type Nace = { code: string; title: string };
type Catalogue = { source: string; version: string; partial: boolean; items: Nace[] };
type Result = { codes: string[]; known: Nace[]; unknown: string[]; needsReview: boolean };

/**
 * Registration step "Faaliyet": search a NACE class by code or activity name, pick it, confirm it.
 * The catalogue is a sourced, partial subset: a code that is not in it is kept and sent to review, never guessed.
 */
export function ActivityPicker({ onContinue }: { onContinue: (r: Result) => void }) {
  const { call, company } = useSession();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Catalogue | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [manual, setManual] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { call<Catalogue>('GET', `/nace?q=${encodeURIComponent(q)}`).then(setCat).catch(e => setError(errorText(e))); }, 200);
    return () => clearTimeout(t);
  }, [q, call]);

  const toggle = (code: string) => { setConfirmed(false); setPicked(p => (p.includes(code) ? p.filter(c => c !== code) : [...p, code])); };
  const codes = [...picked, ...(manual.trim() ? [manual.trim()] : [])];
  const titleOf = (code: string) => cat?.items.find(i => i.code === code)?.title;

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = await call<Result>('POST', `/companies/${company!.id}/activity`, { naceCodes: codes, confirmed: true });
      setResult(r);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <View style={{ gap: 12 }}>
      <Field label="Faaliyet ara (kod ya da ad)" testID="nace-search" value={q} onChangeText={setQ} placeholder="ör. 56.10 ya da kafe, emlak" />
      <View style={{ gap: 8 }}>
        {cat?.items.map(i => {
          const on = picked.includes(i.code);
          return (
            <Tap key={i.code} testID={`nace-${i.code}`} onPress={() => toggle(i.code)} accessibilityState={{ selected: on }}
              style={{ borderWidth: 1, borderRadius: 16, padding: 13, gap: 3, borderColor: on ? tint.lime(0.45) : C.bds, backgroundColor: on ? tint.lime(0.1) : C.card }}>
              <Text style={type(12, 700, { color: on ? C.lime : C.t2 })}>{i.code}</Text>
              <Text style={type(13.5, 500, { lh: 1.4 })}>{i.title}</Text>
            </Tap>
          );
        })}
        {cat && cat.items.length === 0 ? <Text style={type(13, 400, { color: C.t2, lh: 1.5 })}>Listede bulunamadı. Kodunu aşağıya yazabilirsin; tanımadığımız kod incelemeye gider, yükümlülükler "bilgi eksik" kalır.</Text> : null}
        {cat ? <Text style={type(11, 400, { color: C.t3, lh: 1.5 })}>Kaynak: {cat.source} · {cat.version}{cat.partial ? ' · başlangıç alt kümesi, tam sınıflama değildir' : ''}</Text> : null}
      </View>
      <Field label="Listede yoksa NACE kodu" testID="nace-manual" value={manual} onChangeText={t => { setManual(t); setConfirmed(false); }} placeholder="ör. 47.11" />

      {codes.length > 0 && (
        <View style={{ borderWidth: 1, borderColor: C.bd, borderRadius: 18, backgroundColor: C.card, padding: 14, gap: 8 }}>
          <Text style={type(13, 600)}>Faaliyetin şöyle kaydedilecek:</Text>
          {codes.map(c => <Text key={c} style={type(13, 400, { lh: 1.45, color: C.t2 })}>• {c}{titleOf(c) ? ` — ${titleOf(c)}` : ' — listede yok, incelemeye gider'}</Text>)}
          <Tap testID="nace-confirm" onPress={() => setConfirmed(v => !v)} accessibilityState={{ checked: confirmed }}
            style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 6 }}>
            <View style={{ width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: confirmed ? C.lime : C.bds, backgroundColor: confirmed ? tint.lime(0.25) : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              {confirmed ? <Text style={type(13, 800, { color: C.lime })}>✓</Text> : null}
            </View>
            <Text style={[type(13, 500, { lh: 1.4 }), { flex: 1 }]}>Doğru, işletmemin faaliyeti bu.</Text>
          </Tap>
        </View>
      )}

      {result ? (
        <View style={{ gap: 6 }}>
          <Text style={type(14, 600, { color: result.needsReview ? C.warn : C.lime })}>
            {result.needsReview ? `Kaydedildi; ${result.unknown.join(', ')} incelemeye alındı.` : 'Faaliyet kaydedildi.'}
          </Text>
          {result.needsReview ? <Text style={type(12.5, 400, { lh: 1.5, color: C.t2 })}>Tanımadığımız kod için hiçbir yükümlülük "uygulanmaz" sayılmadı; yemek hazırlama sorusunu bir sonraki adımda kendin cevaplayabilirsin.</Text> : null}
        </View>
      ) : null}
      {error ? <ErrorBox message={error} /> : null}
      {result
        ? <PrimaryButton testID="nace-continue" label="Devam et" onPress={() => onContinue(result)} />
        : <PrimaryButton testID="nace-save" label={busy ? 'Kaydediliyor…' : 'Faaliyeti kaydet'} disabled={busy || !codes.length || !confirmed} onPress={save} />}
    </View>
  );
}
