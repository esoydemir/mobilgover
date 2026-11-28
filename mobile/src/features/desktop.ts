import { Platform, useWindowDimensions } from 'react-native';

/** Masaüstü genişliği: platform yönetim ekranları telefon çerçevesi olmadan, tam pencerede açılır. */
export const DESKTOP_MIN = 1024;
export const DESKTOP_PATHS = ['/legislation', '/admin', '/rule', '/institution', '/pazar', '/moderation', '/kullanicilar', '/denetim', '/kurallar'];
/** Kenar çubuklu yönetim kabuğunun açıldığı yollar (/rule ve /institution kabuksuz tam genişlikte kalır). */
export const SHELL_PATHS = ['/admin', '/legislation', '/pazar', '/moderation', '/kullanicilar', '/denetim', '/kurallar'];
export const isShellPath = (p: string) => SHELL_PATHS.some(x => p === x || p.startsWith(`${x}/`));
export const isDeskPath = (p: string) => DESKTOP_PATHS.some(x => p === x || p.startsWith(`${x}/`));
/** Business screens that compare things side by side: on a wide window they get a wider column (tab bar kept). */
export const WIDE_PATHS = ['/board'];
export const WIDE_WIDTH = 980;
export function useDesktop() { const w = useWindowDimensions().width; return Platform.OS === 'web' && w >= DESKTOP_MIN; }
