/**
 * Açık ve koyu görünümün tek renk kaynağı. Anlamlar iki görünümde aynıdır; yalnız değerler değişir.
 * `accent` GoverHub yeşilidir: dolgu (birincil işlem, seçim). `lime` aynı markanın okunabilir tonudur: metin, simge, çizgi.
 */
export const LIGHT = {
  bg: '#F3F4EF', page: '#E9EBE3', card: '#FFFFFF', sheet: '#FFFFFF', chip: '#F7F8F4', tile: '#ECEEE6',
  accent: '#C6FF3D', accentHover: '#B8F52A', lime: '#356A07', ink: '#101A00',
  t1: '#171B12', t2: '#454B3D', t3: '#5C6353',
  bd: '#E0E3D8', bds: '#C6CBBB', track: '#E4E7DC', ringIdle: '#A9B09C',
  crit: '#B0231A', warn: '#7F4F00', info: '#175A99',
  glass: 'rgba(252,253,249,0.74)', shadow: 'rgba(32,40,20,0.14)',
} as const;
export type ColorName = keyof typeof LIGHT;
export const DARK: Record<ColorName, string> = {
  bg: '#0F110D', page: '#090A08', card: '#191C16', sheet: '#171A14', chip: '#1E221A', tile: '#272C22',
  accent: '#C6FF3D', accentHover: '#D4FF66', lime: '#BDF23A', ink: '#101A00',
  t1: '#F2F4EC', t2: '#C2C8B8', t3: '#9AA18E',
  bd: '#2A2F24', bds: '#3D4434', track: '#2B3025', ringIdle: '#5B6350',
  crit: '#FF958C', warn: '#F7C455', info: '#93C6F6',
  glass: 'rgba(22,25,19,0.72)', shadow: 'rgba(0,0,0,0.45)',
};
