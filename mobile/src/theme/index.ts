import type { TextStyle } from 'react-native';

import { Platform } from 'react-native';
import { nativeScheme } from './appearance';
import { DARK, LIGHT, type ColorName } from './palette';

/**
 * Renk belirteçleri. Web'de her biri bir CSS değişkenidir (açık ve koyu görünüm `appearance.ts` içinde tanımlanır);
 * native derlemede açılıştaki cihaz görünümünün değeridir.
 */
const web = Platform.OS === 'web';
const palette: Record<ColorName, string> = web || nativeScheme() === 'light' ? LIGHT : DARK;
export const C = Object.fromEntries((Object.keys(LIGHT) as ColorName[]).map(k => [k, web ? `var(--m-${k})` : palette[k]])) as Record<ColorName, string>;

const mix = (name: ColorName) => (a: number) => {
  // react-native-web yalnız `var(` ile başlayan değerleri olduğu gibi geçirir; karışım bu yüzden yedek değer olarak yazılır.
  if (web) return `var(--m-mix,color-mix(in srgb,var(--m-${name}) ${Math.round(a * 100)}%,transparent))`;
  const n = parseInt(palette[name].slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};

/** Tinted fills used for status chips and callouts. `white` is the neutral overlay: dark on light, light on dark. */
export const tint = { lime: mix('lime'), crit: mix('crit'), warn: mix('warn'), info: mix('info'), white: mix('t1') };

/** Buzlu cam: yalnız araç çubuğu ve gezinme yüzeylerinde; arkasından kayan içerik hafifçe seçilir. Metin alanları opaktır. */
export const glass = (web
  ? { backgroundColor: C.glass, backdropFilter: 'blur(18px) saturate(1.5)', WebkitBackdropFilter: 'blur(18px) saturate(1.5)' }
  : { backgroundColor: palette.card }) as { backgroundColor: string };
export const lift = { boxShadow: `0 10px 30px ${C.shadow}` } as const;

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

type Family = 'inter' | 'mono';
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
  opts: { family?: Family | 'outfit'; ls?: number; lh?: number; color?: string } = {},
): TextStyle {
  // Başlıklar da gövde ailesini kullanır (gazete tipi başlık ailesi kaldırıldı); en küçük punto 11'dir.
  const family = opts.family === 'mono' ? 'mono' : 'inter';
  size = Math.max(size, 11);
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
