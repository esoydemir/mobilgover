import { useId } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

export type GradStop = [offset: number, color: string];

type Props = {
  /** CSS-style angle in degrees (e.g. 165 for `linear-gradient(165deg, …)`). */
  angle?: number;
  stops: GradStop[];
  /** Optional radial glow layered on top, positioned in fractions of the box. */
  radial?: { cx: number; cy: number; r: number; stops: GradStop[] };
};

/**
 * Absolute-fill gradient background. Place it as the first child of a view
 * that has `overflow: 'hidden'` and a border radius.
 */
export function GradientFill({ angle = 180, stops, radial }: Props) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad) / 2;
  const dy = -Math.cos(rad) / 2;
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
      <Defs>
        <LinearGradient id={`l${id}`} x1={0.5 - dx} y1={0.5 - dy} x2={0.5 + dx} y2={0.5 + dy}>
          {stops.map(([o, c], i) => <Stop key={i} offset={o} stopColor={c} />)}
        </LinearGradient>
        {radial && (
          <RadialGradient id={`r${id}`} cx={radial.cx} cy={radial.cy} fx={radial.cx} fy={radial.cy} r={radial.r}>
            {radial.stops.map(([o, c], i) => <Stop key={i} offset={o} stopColor={c} />)}
          </RadialGradient>
        )}
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#l${id})`} />
      {radial && <Rect width="100%" height="100%" fill={`url(#r${id})`} />}
    </Svg>
  );
}
