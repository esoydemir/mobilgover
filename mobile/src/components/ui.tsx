import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View, type PressableProps, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { C, SEV, eyebrow, limeGlow, tint, type, type Sev } from '../theme';

export const nativeDriver = Platform.OS !== 'web';

/** Pressable with the prototype's subtle press feedback. */
/** iPhone HIG minimum touch target. react-native-web ignores `hitSlop`, so the size is real, not a slop. */
export const MIN_TAP = 44;

export function Tap({ style, children, disabled, ...rest }: PressableProps & { style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={({ pressed }) => [{ minHeight: MIN_TAP, minWidth: MIN_TAP }, style, pressed && !disabled && { opacity: 0.82 }]}
      {...rest}
    >
      {children}
    </Pressable>
  );
}

export function Card({ children, style, radius = 26, border = C.bd, bg = C.card, testID }: {
  children: ReactNode; style?: StyleProp<ViewStyle>; radius?: number; border?: string; bg?: string; testID?: string;
}) {
  return <View testID={testID} style={[{ borderWidth: 1, borderColor: border, borderRadius: radius, backgroundColor: bg, paddingVertical: 17, paddingHorizontal: 18 }, style]}>{children}</View>;
}

export const Eyebrow = ({ children, color, style }: { children: ReactNode; color?: string; style?: StyleProp<TextStyle> }) => (
  <Text style={[eyebrow(color), style]}>{children}</Text>
);

/** Rounded status chip ("KRİTİK", "GEÇERLİ", …). */
export function Pill({ label, fg, bg, size = 9.5, ls = 0.08, style }: { label: string; fg: string; bg: string; size?: number; ls?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999, backgroundColor: bg }, style]}>
      <Text style={type(size, 700, { ls, color: fg })}>{label}</Text>
    </View>
  );
}

export const SevPill = ({ sev, big }: { sev: Sev; big?: boolean }) => (
  <Pill label={SEV[sev].label} fg={SEV[sev].fg} bg={SEV[sev].bg} ls={big ? 0.09 : 0.08} style={big && { paddingVertical: 5, paddingHorizontal: 9 }} />
);

type PrimaryProps = { label: string; onPress?: () => void; height?: number; size?: number; style?: StyleProp<ViewStyle>; disabled?: boolean; glow?: boolean; testID?: string; why?: string | null };

/** B-03: why a button is inactive (what is missing or not allowed), written next to it. Undefined when nothing is missing. */
export const shortWhy = (value: string, min: number, what: string) => { const n = value.trim().length; return n < min ? `${what} en az ${min} karakter olmalı (şu an ${n}).` : undefined; };
/** Several conditions: names every one still missing, e.g. "Eksik: başlık (en az 5 karakter), tehlike türü". */
export const missingWhy = (checks: [boolean, string][]) => { const m = checks.filter(([bad]) => bad).map(([, t]) => t); return m.length ? `Eksik: ${m.join(', ')}.` : undefined; };
const Why = ({ text, testID }: { text: string; testID?: string }) => <Text testID={testID ? `${testID}-why` : 'disabled-why'} style={type(11.5, 500, { color: C.warn, lh: 1.35 })}>{text}</Text>;

export function PrimaryButton(props: PrimaryProps) {
  if (props.disabled && props.why) return <View style={[{ gap: 5 }, props.style]}><PrimaryBtn {...props} style={undefined} /><Why text={props.why} testID={props.testID} /></View>;
  return <PrimaryBtn {...props} />;
}
function PrimaryBtn({ label, onPress, height = 52, size = 14.5, style, disabled, glow = true, testID }: PrimaryProps) {
  return (
    <Tap
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      style={[
        { height, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
        disabled ? { backgroundColor: C.tile, opacity: 0.6 } : { backgroundColor: C.lime, boxShadow: glow ? limeGlow : undefined },
        style,
      ]}
    >
      <Text style={type(size, 700, { color: disabled ? C.t3 : C.ink })}>{label}</Text>
    </Tap>
  );
}

type GhostProps = { label: string; onPress?: () => void; height?: number; size?: number; style?: StyleProp<ViewStyle>; color?: string; border?: string; bg?: string; testID?: string; disabled?: boolean; why?: string | null };
export function GhostButton(props: GhostProps) {
  if (props.disabled && props.why) return <View style={[{ gap: 5 }, props.style]}><GhostBtn {...props} style={undefined} /><Why text={props.why} testID={props.testID} /></View>;
  return <GhostBtn {...props} />;
}
function GhostBtn({ label, onPress, height = 48, size = 13.5, style, color = C.t1, border = C.bds, bg = 'transparent', testID, disabled }: GhostProps) {
  return (
    <Tap testID={testID} disabled={disabled} onPress={onPress} style={[{ height, borderRadius: 999, borderWidth: 1, borderColor: border, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 }, style]}>
      <Text style={type(size, 600, { color })}>{label}</Text>
    </Tap>
  );
}

/** Segmented filter chip (Bugün / Gecikmiş / Yaklaşan …). */
export function FilterChip({ label, active, onPress, px = 15, testID }: { label: string; active: boolean; onPress: () => void; px?: number; testID?: string }) {
  return (
    <Tap
      testID={testID}
      onPress={onPress}
      style={{
        height: 34, paddingHorizontal: px, borderRadius: 999, justifyContent: 'center', borderWidth: 1,
        borderColor: active ? tint.lime(0.4) : C.bd, backgroundColor: active ? tint.lime(0.1) : C.chip,
      }}
    >
      <Text style={type(12.5, 600, { color: active ? C.lime : C.t2 })}>{label}</Text>
    </Tap>
  );
}

/** Square tile holding an emoji or initials. */
export function Tile({ children, size = 38, radius = 12, fontSize = 17, initials }: { children: ReactNode; size?: number; radius?: number; fontSize?: number; initials?: boolean }) {
  return (
    <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: C.tile, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={initials ? type(fontSize, 700, { family: 'outfit', color: C.t2 }) : { fontSize }}>{children}</Text>
    </View>
  );
}

export const Chevron = ({ size = 15 }: { size?: number }) => <Text style={type(size, 400, { color: C.t3 })}>›</Text>;

/** Tinted callout block (blue info, amber warning, lime hint). */
export function Callout({ tone, title, body, children, radius = 18 }: { tone: 'info' | 'warn' | 'lime'; title?: string; body?: ReactNode; children?: ReactNode; radius?: number }) {
  const fg = tone === 'info' ? C.info : tone === 'warn' ? C.warn : C.lime;
  const t = tone === 'info' ? tint.info : tone === 'warn' ? tint.warn : tint.lime;
  return (
    <View style={{ borderWidth: 1, borderColor: t(tone === 'warn' ? 0.26 : tone === 'info' ? 0.24 : 0.22), backgroundColor: t(tone === 'lime' ? 0.04 : tone === 'warn' ? 0.05 : 0.06), borderRadius: radius, paddingVertical: 14, paddingHorizontal: 16 }}>
      {title ? <Text style={type(13.5, 600, { color: fg })}>{title}</Text> : null}
      {body ? <Text style={[type(12, 400, { lh: 1.5, color: C.t2 }), title ? { marginTop: 5 } : null]}>{body}</Text> : null}
      {children}
    </View>
  );
}

/** Circular step marker used by CAPA, roadmap and scan steps. */
export function StepMark({ state, size = 22 }: { state: 'done' | 'active' | 'todo'; size?: number }) {
  const ring = state === 'done' ? C.lime : state === 'active' ? C.warn : C.ringIdle;
  return (
    <View style={{ width: size, height: size, borderRadius: 999, borderWidth: 1.5, borderColor: ring, backgroundColor: state === 'done' ? C.lime : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={type(10, 800, { color: state === 'done' ? C.ink : C.warn })}>{state === 'done' ? '✓' : state === 'active' ? '●' : ''}</Text>
    </View>
  );
}

/** Round checkbox + title + severity chip, used on Home and Tasks. */
export function TaskRow({ title, meta, sev, done, onToggle, onOpen }: { title: string; meta: string; sev: Sev; done: boolean; onToggle: () => void; onOpen: () => void }) {
  return (
    <View style={[s.row, { borderRadius: 24, paddingVertical: 16, paddingHorizontal: 17, gap: 13 }]}>
      <Tap
        onPress={onToggle}
        accessibilityLabel={done ? 'Tamamlanmadı olarak işaretle' : 'Tamamlandı olarak işaretle'}
        hitSlop={8}
        style={{ width: 28, height: 28, borderRadius: 999, borderWidth: 2, borderColor: done ? C.lime : C.ringIdle, backgroundColor: done ? C.lime : 'transparent', alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={[type(12, 800, { color: C.ink }), { opacity: done ? 1 : 0 }]}>✓</Text>
      </Tap>
      <Tap onPress={onOpen} style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type(14.5, 600, { ls: -0.01 }), done && { textDecorationLine: 'line-through' }]}>{title}</Text>
        <Text style={[type(12, 400, { color: C.t3 }), { marginTop: 3 }]}>{meta}</Text>
      </Tap>
      <SevPill sev={sev} />
    </View>
  );
}

/** Dot-and-rail timeline row (calendar, evidence chain). */
export function TimelineRow({ left, title, meta, dot, mono, leftSize = 11, dotTop = 4, pb = 16, titleSize = 13.5 }: {
  left: string; title: string; meta: string; dot: string; mono?: boolean; leftSize?: number; dotTop?: number; pb?: number; titleSize?: number;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 13, alignItems: 'stretch' }}>
      <Text style={[type(leftSize, 500, { family: 'mono', color: C.t2 }), { width: 52, paddingTop: 1 }]}>{left}</Text>
      <View style={{ width: 9, alignItems: 'center' }}>
        <View style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: dot, marginTop: dotTop }} />
        <View style={{ flex: 1, width: 1, backgroundColor: C.bd }} />
      </View>
      <View style={{ flex: 1, paddingBottom: pb }}>
        <Text style={type(titleSize, 600, { ls: -0.01 })}>{title}</Text>
        <Text style={[type(mono ? 10 : 11.5, 400, { family: mono ? 'mono' : 'inter', color: C.t3 }), { marginTop: mono ? 3 : 2 }]}>{meta}</Text>
      </View>
    </View>
  );
}

/** Thin progress bar. */
export function Bar({ pct, height = 3, color = C.lime, track = tint.white(0.09), style }: { pct: number; height?: number; color?: string; track?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ height, borderRadius: 999, backgroundColor: track, overflow: 'hidden' }, style]}>
      <View style={{ width: `${Math.round(pct * 100)}%`, height: '100%', borderRadius: 999, backgroundColor: color }} />
    </View>
  );
}

/** Looping opacity pulse (notification dot, sync state). */
export function Pulse({ children }: { children: ReactNode }) {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 0.3, duration: 1200, useNativeDriver: nativeDriver }),
      Animated.timing(v, { toValue: 1, duration: 1200, useNativeDriver: nativeDriver }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={{ opacity: v }}>{children}</Animated.View>;
}

/** Enter animation: `gh-rise` (fade + 12px lift) from the prototype. */
export function Rise({ children, delay = 0, duration = 260, style }: { children: ReactNode; delay?: number; duration?: number; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration, delay, useNativeDriver: nativeDriver }).start();
  }, [v, delay, duration]);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

export const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.bd, backgroundColor: C.card },
  stack: { gap: 12 },
});
