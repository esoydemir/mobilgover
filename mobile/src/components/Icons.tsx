import Svg, { Circle, Path } from 'react-native-svg';
import { C } from '../theme';

type P = { size?: number; color?: string; stroke?: number };

const line = (color: string, stroke: number) => ({
  fill: 'none',
  stroke: color,
  strokeWidth: stroke,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const HomeIcon = ({ size = 21, color = C.t1, stroke = 1.9 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...line(color, stroke)}>
    <Path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />
  </Svg>
);

export const TasksIcon = ({ size = 21, color = C.t1, stroke = 1.9 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...line(color, stroke)}>
    <Path d="M9 6h11M9 12h11M9 18h11" />
    <Path d="M4 6l1.4 1.4L8 4.6M4 12l1.4 1.4L8 10.6M4 18l1.4 1.4L8 16.6" />
  </Svg>
);

export const ScanIcon = ({ size = 24, color = C.t1, stroke = 1.9 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...line(color, stroke)}>
    <Path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3M3 12h18" />
  </Svg>
);

export const DocsIcon = ({ size = 21, color = C.t1, stroke = 1.9 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...line(color, stroke)}>
    <Path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <Path d="M13 3v5h5M8.5 13h7M8.5 17h4" />
  </Svg>
);

export const GridIcon = ({ size = 21, color = C.t1, stroke = 1.9 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...line(color, stroke)}>
    {[5.5, 12, 18.5].flatMap(y => [5.5, 12, 18.5].map(x => <Circle key={`${x}-${y}`} cx={x} cy={y} r={2.2} />))}
  </Svg>
);

export const SearchIcon = ({ size = 18, color = C.t2, stroke = 1.8 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...line(color, stroke)}>
    <Circle cx={11} cy={11} r={7} />
    <Path d="m20 20-3.5-3.5" />
  </Svg>
);

export const BellIcon = ({ size = 18, color = C.t2, stroke = 1.8 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...line(color, stroke)}>
    <Path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6M10.5 20a2 2 0 0 0 3 0" />
  </Svg>
);

export const BackIcon = ({ size = 17, color = C.t1, stroke = 2 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...line(color, stroke)}>
    <Path d="M14 6l-6 6 6 6" />
  </Svg>
);

export const WarnIcon = ({ size = 13, color = C.crit, stroke = 2.3 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...line(color, stroke)}>
    <Path d="M12 3 2 20h20L12 3zM12 9.5v4.5M12 17.4v.6" />
  </Svg>
);

export const CameraIcon = ({ size = 20, color = C.t2, stroke = 1.8 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...line(color, stroke)}>
    <Path d="M3 8.5A2 2 0 0 1 5 6.5h1.5l1.2-2h8.6l1.2 2H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8.5z" />
    <Circle cx={12} cy={12.8} r={3.2} />
  </Svg>
);

export const VerifiedBadge = ({ size = 13, color = C.lime }: { size?: number; color?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path fill={color} d="M12 2l2.4 1.7 2.9-.2 1 2.7 2.4 1.6-.8 2.8.8 2.8-2.4 1.6-1 2.7-2.9-.2L12 21.5l-2.4-1.7-2.9.2-1-2.7L3.3 15.7l.8-2.8-.8-2.8 2.4-1.6 1-2.7 2.9.2z" />
    <Path d="M8.6 12.2l2.2 2.2 4.4-4.4" stroke={C.ink} strokeWidth={2} fill="none" strokeLinecap="round" />
  </Svg>
);
