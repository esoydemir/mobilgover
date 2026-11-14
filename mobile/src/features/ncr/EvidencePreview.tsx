import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Text, View } from 'react-native';
import { useSession } from '../../api/session';
import { GhostButton, Pill, Tap } from '../../components/ui';
import { C, tint, type } from '../../theme';
import { fetchEvidenceUri, openEvidence } from '../files';

/**
 * A photo evidence file shown inside the case screen. Tap the pill: the image is fetched with the session's
 * authorisation and drawn in place (no pop-up tab, which iOS Safari may block). While it loads there is a
 * spinner; if it cannot be fetched or decoded the reason is written and "Yeniden dene" tries again.
 */
export function EvidencePreview({ id, label }: { id: string; label: string }) {
  const { token, company } = useSession();
  const [state, setState] = useState<'closed' | 'loading' | 'ready' | 'error'>('closed');
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const release = useRef<() => void>(() => {});
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; release.current(); }, []);

  const load = useCallback(async () => {
    setState('loading'); setError(null);
    release.current(); release.current = () => {};
    try {
      const r = await fetchEvidenceUri(token, company!.id, id);
      if (!alive.current) { r.release(); return; }
      release.current = r.release;
      setUri(r.uri); setState('ready');
    } catch (e) {
      if (!alive.current) return;
      setError((e as Error).message || 'Fotoğraf yüklenemedi.'); setState('error');
    }
  }, [token, company, id]);

  const toggle = () => { if (state === 'closed') void load(); else { release.current(); release.current = () => {}; setUri(null); setState('closed'); } };

  return (
    <View style={{ gap: 6, width: state === 'closed' ? undefined : '100%' }}>
      <Tap testID={`action-evidence-open-${id}`} onPress={toggle} style={{ alignSelf: 'flex-start' }}>
        <Pill label={`${label} · ${state === 'closed' ? 'AÇ' : 'KAPAT'}`} fg={C.info} bg={tint.info(0.12)} />
      </Tap>
      {state === 'loading' ? (
        <View testID={`evidence-loading-${id}`} style={{ height: 120, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <ActivityIndicator color={C.lime} />
          <Text style={type(11.5, 500, { color: C.t3 })}>Fotoğraf yükleniyor…</Text>
        </View>
      ) : null}
      {state === 'ready' && uri ? (
        <View style={{ gap: 6 }}>
          <Image testID={`evidence-image-${id}`} accessibilityLabel={label} source={{ uri }} resizeMode="contain"
            onError={() => { setError('Görsel okunamadı (dosya bozuk ya da desteklenmeyen biçim).'); setState('error'); }}
            style={{ width: '100%', height: 260, borderRadius: 12, backgroundColor: C.chip }} />
          <View style={{ flexDirection: 'row', gap: 7 }}>
            <GhostButton testID={`evidence-newtab-${id}`} label="Tam boyut" height={32} size={11}
              onPress={async () => { try { await openEvidence(token, company!.id, id); } catch (e) { setError((e as Error).message); setState('error'); } }} />
          </View>
        </View>
      ) : null}
      {state === 'error' ? (
        <View testID={`evidence-error-${id}`} style={{ gap: 6, borderWidth: 1, borderColor: tint.crit(0.3), borderRadius: 12, padding: 10 }}>
          <Text style={type(12, 500, { color: C.crit, lh: 1.45 })}>{error}</Text>
          <GhostButton testID={`evidence-retry-${id}`} label="Yeniden dene" height={32} size={11} style={{ alignSelf: 'flex-start' }} onPress={() => void load()} />
        </View>
      ) : null}
    </View>
  );
}
