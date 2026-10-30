import { BlurView } from 'expo-blur';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../state/app';
import { tint } from '../theme';
import { nativeDriver } from './ui';

const SIZE = 52;
const IDLE_MS = 2600;

/**
 * GoverHub assistant button that behaves like iOS AssistiveTouch: drag it
 * anywhere, it snaps to the nearest side edge, fades to 42% after a short
 * idle period, and only a real tap (not a drag) opens the assistant.
 */
export function AssistantFab({ width, height }: { width: number; height: number }) {
  const { openSheet } = useApp();
  const insets = useSafeAreaInsets();
  const [dragging, setDragging] = useState(false);
  const [idle, setIdle] = useState(false);
  const pos = useRef(new Animated.ValueXY({ x: width - 76, y: height - 204 })).current;
  const last = useRef({ x: width - 76, y: height - 204 });
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fade = useRef(new Animated.Value(0.95)).current;
  const scale = useRef(new Animated.Value(1)).current;

  const minY = insets.top + 60;
  const maxY = height - 112 - insets.bottom;

  const armIdle = () => {
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS);
  };

  useEffect(() => {
    armIdle();
    return () => clearTimeout(idleTimer.current);
  }, []);

  // Keep the button on its edge when the window size changes (rotation, web resize).
  useEffect(() => {
    const x = last.current.x + SIZE / 2 < width / 2 ? 12 : width - 64;
    const y = Math.max(minY, Math.min(maxY, last.current.y));
    last.current = { x, y };
    pos.setValue({ x, y });
  }, [width, height, minY, maxY, pos]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: dragging ? 1 : idle ? 0.42 : 0.95, duration: dragging ? 120 : 500, useNativeDriver: nativeDriver }),
      Animated.timing(scale, { toValue: dragging ? 1.08 : 1, duration: 140, easing: Easing.bezier(0.2, 0.7, 0.2, 1), useNativeDriver: nativeDriver }),
    ]).start();
  }, [dragging, idle, fade, scale]);

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      clearTimeout(idleTimer.current);
      setIdle(false);
      setDragging(true);
    },
    onPanResponderMove: (_, g) => {
      pos.setValue({
        x: Math.max(8, Math.min(width - 60, last.current.x + g.dx)),
        y: Math.max(minY, Math.min(maxY, last.current.y + g.dy)),
      });
    },
    onPanResponderRelease: (_, g) => {
      setDragging(false);
      const moved = Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3;
      if (!moved) {
        openSheet('ai');
        armIdle();
        return;
      }
      const x = Math.max(8, Math.min(width - 60, last.current.x + g.dx));
      const y = Math.max(minY, Math.min(maxY, last.current.y + g.dy));
      const snapX = x + SIZE / 2 < width / 2 ? 12 : width - 64;
      last.current = { x: snapX, y };
      Animated.timing(pos, { toValue: { x: snapX, y }, duration: 340, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: false }).start();
      armIdle();
    },
    onPanResponderTerminate: () => { setDragging(false); armIdle(); },
  }), [width, minY, maxY, openSheet, pos]);

  return (
    <Animated.View
      {...responder.panHandlers}
      accessibilityRole="button"
      accessibilityLabel="GoverHub asistan"
      style={{ position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE, transform: pos.getTranslateTransform(), zIndex: 6 }}
    >
      <Animated.View style={{ flex: 1, opacity: fade, transform: [{ scale }], borderRadius: 17, overflow: 'hidden', boxShadow: '0 6px 18px rgba(0,0,0,0.32)' }}>
        <BlurView intensity={30} tint="dark" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: `rgba(118,124,110,${dragging ? 0.5 : 0.34})` }}>
          <View style={{ width: 38, height: 38, borderRadius: 12, borderWidth: 2, borderColor: tint.white(dragging ? 0.85 : 0.6), alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 19, height: 19, borderRadius: 999, backgroundColor: tint.lime(dragging ? 1 : 0.85), boxShadow: `0 0 12px ${tint.lime(dragging ? 0.55 : 0.3)}` }} />
          </View>
        </BlurView>
      </Animated.View>
    </Animated.View>
  );
}
