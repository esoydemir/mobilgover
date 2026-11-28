import { useSyncExternalStore } from 'react';
import { Appearance, Platform } from 'react-native';
import { DARK, LIGHT, type ColorName } from './palette';

/**
 * Görünüm tercihi. Web'de renkler CSS değişkenidir: tercih değişince ekran yeniden kurulmadan boyanır ve
 * "sistem" seçiliyse cihazın ayarı izlenir. Native derlemede renkler açılışta cihaz ayarından okunur.
 */
export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'gh.theme';
const web = Platform.OS === 'web' && typeof document !== 'undefined';
const stored = (): ThemePref => {
  try { const v = globalThis.localStorage?.getItem(KEY) ?? globalThis.localStorage?.getItem('gh.desk.theme'); if (v === 'light' || v === 'dark' || v === 'system') return v; } catch { /* depolama kapalı */ }
  return 'system';
};
let pref: ThemePref = web ? stored() : 'system';
const listeners = new Set<() => void>();

const vars = (p: Record<ColorName, string>) => Object.entries(p).map(([k, v]) => `--m-${k}:${v}`).join(';');
const apply = () => { if (!web) return; if (pref === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = pref; };
if (web) {
  const s = document.createElement('style'); s.id = 'gh-theme';
  s.textContent = `:root{${vars(LIGHT)};color-scheme:light}`
    + `@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${vars(DARK)};color-scheme:dark}}`
    + `:root[data-theme=dark]{${vars(DARK)};color-scheme:dark}`
    + 'html,body,#root{background:var(--m-bg)}input,textarea{caret-color:var(--m-lime)}input:focus-visible,textarea:focus-visible{outline:2px solid var(--m-lime);outline-offset:0}';
  document.head.appendChild(s); apply();
}

export const nativeScheme = (): 'light' | 'dark' => (Appearance.getColorScheme() === 'dark' ? 'dark' : 'light');
export function setThemePref(next: ThemePref) {
  pref = next;
  try { globalThis.localStorage?.setItem(KEY, next); globalThis.localStorage?.removeItem('gh.desk.theme'); } catch { /* sessiz */ }
  apply(); listeners.forEach(f => f());
}
const dark = () => (web ? globalThis.matchMedia?.('(prefers-color-scheme: dark)') : undefined);
const resolved = (): 'light' | 'dark' => (pref !== 'system' ? pref : web ? (dark()?.matches ? 'dark' : 'light') : nativeScheme());
const subscribe = (f: () => void) => {
  listeners.add(f); const mq = dark(); mq?.addEventListener?.('change', f);
  return () => { listeners.delete(f); mq?.removeEventListener?.('change', f); };
};
export const useThemePref = () => useSyncExternalStore(subscribe, () => pref, () => pref);
export const useScheme = () => useSyncExternalStore(subscribe, resolved, resolved);
