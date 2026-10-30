import { useEffect, useState } from 'react';
import { Easing, Text, View } from 'react-native';
import Svg, { Defs, Path, Text as SvgText, TextPath } from 'react-native-svg';
import { SCORE_DOMAINS } from '../data';
import { C, STATUS, type } from '../theme';

/** Native size of the chart; it is scaled uniformly to the available width. */
const W = 346;
const H = 356;
const CX = 180;
const CY = 190;
const STROKE = 23;
const DURATION = 1050;
const ease = Easing.bezier(0.16, 1, 0.3, 1);

/** 270° sweep: starts at 12 o'clock, runs clockwise through 3 and 6, ends at 9. */
const arcPath = (r: number) => `M${CX},${CY - r} A${r},${r} 0 0 1 ${CX + r},${CY} A${r},${r} 0 1 1 ${CX - r},${CY}`;
const arcLength = (r: number) => 1.5 * Math.PI * r;

/** Draw-in progress for each ring, staggered like the prototype's CSS animation. */
function useDrawIn(count: number) {
  const [progress, setProgress] = useState<number[]>(() => Array(count).fill(0));
  useEffect(() => {
    let frame = 0;
    const start = Date.now();
    const tick = () => {
      const t = Date.now() - start;
      const next = Array.from({ length: count }, (_, i) => {
        const local = (t - (80 + i * 60)) / DURATION;
        return ease(Math.max(0, Math.min(1, local)));
      });
      setProgress(next);
      if (next.some(p => p < 1)) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [count]);
  return progress;
}

/**
 * Nested 270° rings, outermost = documents, innermost = equipment. Each
 * process label sits on a bar along the left edge whose coloured top rule
 * lines up with the start of its ring.
 */
export function ScoreRings({ width }: { width: number }) {
  const k = Math.min(1, width / W);
  const progress = useDrawIn(SCORE_DOMAINS.length);
  return (
    <View style={{ width: W * k, height: H * k, marginTop: 12, marginLeft: -3 * k }}>
      <View style={{ width: W, height: H, transform: [{ scale: k }], transformOrigin: 'top left' }}>
        <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', left: 0, top: 0 }}>
          <Defs>
            <Path id="ghOuterTxt" d="M180,14 A176,176 0 0 1 356,190" fill="none" />
            <Path id="ghInnerTxt" d="M20,190 A160,160 0 0 0 180,350" fill="none" />
          </Defs>
          {SCORE_DOMAINS.map(d => (
            <Path key={`t${d.key}`} d={arcPath(d.r)} fill="none" stroke={C.bd} strokeWidth={STROKE} strokeLinecap="round" />
          ))}
          {SCORE_DOMAINS.map((d, i) => {
            const L = arcLength(d.r);
            const dash = d.pct * L;
            return (
              <Path
                key={`a${d.key}`}
                d={arcPath(d.r)}
                fill="none"
                stroke={STATUS[d.tone].fg}
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeDasharray={`${dash} ${L}`}
                strokeDashoffset={dash * (1 - progress[i])}
                opacity={progress[i] > 0 ? 1 : 0}
              />
            );
          })}
          <SvgText fontSize={9.5} fontWeight="700" letterSpacing={4.4} fill="rgba(245,245,242,0.28)" fontFamily="Inter_700Bold">
            <TextPath href="#ghOuterTxt" startOffset="17%">TAM UYUM</TextPath>
          </SvgText>
          <SvgText fontSize={9.5} fontWeight="700" letterSpacing={4.4} fill="rgba(245,245,242,0.2)" fontFamily="Inter_700Bold">
            <TextPath href="#ghInnerTxt" startOffset="12%">EKSİK İŞ</TextPath>
          </SvgText>
        </Svg>
        {SCORE_DOMAINS.map(d => {
          const color = STATUS[d.tone].fg;
          return (
            <View
              key={`l${d.key}`}
              pointerEvents="none"
              style={{
                position: 'absolute', left: 0, top: CY - d.r - STROKE / 2, width: 180, height: 28,
                flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 14,
                backgroundColor: '#0A0A0A', borderTopWidth: 3, borderTopColor: color, borderTopRightRadius: 14,
              }}
            >
              <Text numberOfLines={1} style={[type(12.5, 800, { ls: 0.02 }), { flex: 1 }]}>{d.label}</Text>
              <Text style={[type(12, 600, { family: 'mono', color }), { width: 42, textAlign: 'right' }]}>{d.value}</Text>
              <Text style={[type(10, 700, { color: C.t3 }), { width: 30, textAlign: 'right' }]}>{d.unit}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
