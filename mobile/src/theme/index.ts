import type { TextStyle } from 'react-native';

/** Uyum dark/lime design tokens, taken 1:1 from the Claude Design prototype. */
export const C = {
  bg: '#050505',
  page: '#080808',
  lime: '#C6FF3D',
  limeHover: '#CFFF04',
  ink: '#0A1500',
  t1: '#F5F5F2',
  t2: 'rgba(245,245,242,0.55)',
  t3: 'rgba(245,245,242,0.32)',
  bd: 'rgba(255,255,255,0.07)',
  bds: 'rgba(255,255,255,0.13)',
  crit: '#F87171',
  warn: '#FCD34D',
  info: '#93C5FD',
  card: '#111111',
  sheet: '#0F0F0F',
  chip: '#161616',
  tile: '#1E1E1E',
  track: 'rgba(255,255,255,0.08)',
  ringIdle: 'rgba(255,255,255,0.18)',
} as const;

/** Tinted fills used for status chips and callouts. */
export const tint = {
  lime: (a: number) => `rgba(198,255,61,${a})`,
  crit: (a: number) => `rgba(248,113,113,${a})`,
  warn: (a: number) => `rgba(252,211,77,${a})`,
  info: (a: number) => `rgba(147,197,253,${a})`,
  white: (a: number) => `rgba(255,255,255,${a})`,
};

export const SEV = {
  crit: { fg: C.crit, bg: tint.crit(0.14), label: 'KRİTİK' },
  imp: { fg: C.warn, bg: tint.warn(0.14), label: 'ÖNEMLİ' },
  low: { fg: C.info, bg: tint.info(0.14), label: 'İYİLEŞTİRME' },
} as const;
export type Sev = keyof typeof SEV;

/** Status palette shared by documents, equipment and roadmap rows. */
export const STATUS = {
  crit: { fg: C.crit, bg: tint.crit(0.14), bd: tint.crit(0.24) },
  warn: { fg: C.warn, bg: tint.warn(0.14), bd: C.bd },
  ok: { fg: C.lime, bg: tint.lime(0.14), bd: C.bd },
  idle: { fg: C.t3, bg: tint.white(0.08), bd: C.bd },
} as const;
export type Status = keyof typeof STATUS;

export const limeGlow = '0 4px 24px rgba(198,255,61,0.25)';

type Family = 'inter' | 'outfit' | 'mono';
type Weight = 400 | 500 | 600 | 700 | 800 | 900;

const FAMILIES: Record<Family, Partial<Record<Weight, string>>> = {
  inter: {
    400: 'Inter_400Regular',
    500: 'Inter_500Medium',
    600: 'Inter_600SemiBold',
    700: 'Inter_700Bold',
    800: 'Inter_800ExtraBold',
    900: 'Inter_900Black',
  },
  outfit: {
    400: 'Outfit_400Regular',
    500: 'Outfit_500Medium',
    600: 'Outfit_600SemiBold',
    700: 'Outfit_700Bold',
    800: 'Outfit_800ExtraBold',
  },
  mono: {
    400: 'JetBrainsMono_400Regular',
    500: 'JetBrainsMono_500Medium',
    600: 'JetBrainsMono_600SemiBold',
  },
};

/**
 * Builds a text style the way the prototype's CSS reads:
 * size in px, letter-spacing in em, line-height as a multiplier.
 */
export function type(
  size: number,
  weight: Weight = 400,
  opts: { family?: Family; ls?: number; lh?: number; color?: string } = {},
): TextStyle {
  const family = opts.family ?? 'inter';
  return {
    fontFamily: FAMILIES[family][weight] ?? FAMILIES[family][600],
    fontSize: size,
    color: opts.color ?? C.t1,
    ...(opts.ls ? { letterSpacing: opts.ls * size } : null),
    ...(opts.lh ? { lineHeight: opts.lh * size } : null),
  };
}

/** Small uppercase label used above most cards ("UYUM SKORU", "GEÇMİŞ"…). */
export const eyebrow = (color: string = C.t3, size = 10, ls = 0.11): TextStyle =>
  type(size, 600, { ls, color });
