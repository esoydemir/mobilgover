import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUi } from '../state/app';
import { C, lift, tint, type } from '../theme';
import { Rise } from './ui';

export function ToastView() {
  const { toast } = useUi();
  const insets = useSafeAreaInsets();
  if (!toast) return null;
  const warn = toast.kind === 'warn';
  return (
    <Rise
      key={toast.id}
      style={{
        position: 'absolute', left: 16, right: 16, top: insets.top + 14, zIndex: 12,
        flexDirection: 'row', gap: 12, alignItems: 'center',
        borderWidth: 1, borderColor: C.bds, borderRadius: 16, backgroundColor: C.card,
        paddingVertical: 14, paddingHorizontal: 16, ...lift,
      }}
    >
      <View accessibilityLiveRegion="polite" style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: warn ? tint.warn(0.16) : tint.lime(0.16), alignItems: 'center', justifyContent: 'center' }}>
        <Text style={type(14, 800, { color: warn ? C.warn : C.lime })}>{warn ? '!' : '✓'}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={type(13, 600, { ls: -0.01 })}>{toast.title}</Text>
        {toast.body ? <Text style={[type(11.5, 400, { color: C.t2 }), { marginTop: 2 }]}>{toast.body}</Text> : null}
      </View>
    </Rise>
  );
}
