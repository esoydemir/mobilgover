import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Text, TextInput, View, type TextInputProps } from 'react-native';
import { C, tint, type } from '../theme';
import { GhostButton } from './ui';

export function Loading({ label = 'Yükleniyor…' }: { label?: string }) {
  // A wait that goes on says why: usually the connection. The screen keeps retrying by itself when the connection returns.
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), 8000); return () => clearTimeout(t); }, []);
  return (
    <View style={{ paddingVertical: 40, alignItems: 'center', gap: 10 }}>
      <ActivityIndicator color={C.lime} />
      <Text style={type(12.5, 500, { color: C.t3 })}>{label}</Text>
      {slow ? <Text testID="loading-slow" style={[type(12, 400, { color: C.warn, lh: 1.45 }), { textAlign: 'center', paddingHorizontal: 24 }]}>Yükleme uzun sürüyor. Bağlantı yok ya da zayıf olabilir; bağlantı gelince kendiliğinden yeniden denenecek.</Text> : null}
    </View>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={{ borderWidth: 1, borderColor: tint.crit(0.3), backgroundColor: tint.crit(0.07), borderRadius: 18, padding: 15, gap: 10 }}>
      <Text style={type(13, 600, { color: C.crit })}>{message}</Text>
      {onRetry ? <GhostButton label="Tekrar dene" onPress={onRetry} height={38} size={12.5} style={{ alignSelf: 'flex-start' }} /> : null}
    </View>
  );
}

/** Cached data shown while offline is labelled as such. */
export function StaleNote() {
  return (
    <View style={{ borderWidth: 1, borderColor: tint.warn(0.3), backgroundColor: tint.warn(0.06), borderRadius: 14, paddingVertical: 9, paddingHorizontal: 12 }}>
      <Text style={type(11.5, 600, { color: C.warn })}>Çevrimdışı: son eşitlenen bilgiler gösteriliyor.</Text>
    </View>
  );
}

export function Empty({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  return (
    <View style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: C.bds, borderRadius: 22, padding: 18, gap: 6 }}>
      <Text style={type(14, 600)}>{title}</Text>
      {body ? <Text style={type(12.5, 400, { lh: 1.5, color: C.t2 })}>{body}</Text> : null}
      {children}
    </View>
  );
}

/** Example rule/category marker, shown until real legislation is approved. */
export function ExampleBadge({ label = 'ÖRNEK KURAL' }: { label?: string }) {
  return (
    <View accessibilityLabel="Örnek içerik; hukuki dayanağı doğrulanmadı" style={{ alignSelf: 'flex-start', paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, borderWidth: 1, borderColor: tint.warn(0.45), backgroundColor: tint.warn(0.08) }}>
      <Text style={type(9.5, 700, { ls: 0.08, color: C.warn })}>{label}</Text>
    </View>
  );
}

export function Field({ label, hint, ...props }: TextInputProps & { label?: string; hint?: string }) {
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={type(12.5, 600)}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={C.t3}
        {...props}
        style={[type(14.5, 500), { minHeight: 48, borderWidth: 1, borderColor: C.bds, borderRadius: 14, backgroundColor: C.chip, paddingHorizontal: 15, paddingVertical: props.multiline ? 12 : 0 }, props.multiline && { minHeight: 90, textAlignVertical: 'top' }, props.style]}
      />
      {hint ? <Text style={type(11, 400, { color: C.t3, lh: 1.4 })}>{hint}</Text> : null}
    </View>
  );
}

export const SectionLabel = ({ children }: { children: ReactNode }) => (
  <Text style={[type(10.5, 600, { ls: 0.12, color: C.t3 }), { marginTop: 6 }]}>{children}</Text>
);
