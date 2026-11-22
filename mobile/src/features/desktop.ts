import { Platform, useWindowDimensions } from 'react-native';

/** Masaüstü genişliği: platform yönetim ekranları telefon çerçevesi olmadan, tam pencerede açılır. */
export const DESKTOP_MIN = 1024;
export const DESKTOP_PATHS = ['/legislation', '/admin', '/rule', '/institution'];
export const isDeskPath = (p: string) => DESKTOP_PATHS.some(x => p === x || p.startsWith(`${x}/`));
export function useDesktop() { const w = useWindowDimensions().width; return Platform.OS === 'web' && w >= DESKTOP_MIN; }
