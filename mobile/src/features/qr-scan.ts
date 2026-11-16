import jsQR from 'jsqr';

/** The token in a printed QR link or a pasted code (same rule the server enforces: 20–80 URL-safe characters). */
export function tokenFromText(raw: string): string | null {
  const m = raw.trim().match(/([A-Za-z0-9_-]{20,80})\/?$/);
  return m ? m[1]! : null;
}

/** Decodes one RGBA frame; returns the QR text or null when no code is readable. */
export function decodeFrame(rgba: Uint8ClampedArray, width: number, height: number): string | null {
  const r = jsQR(rgba, width, height, { inversionAttempts: 'attemptBoth' });
  return r?.data ? r.data : null;
}

/** The same code seen in several consecutive frames must navigate once: a repeat inside `windowMs` is dropped. */
export function onceWithin(windowMs: number, now: () => number = Date.now) {
  let last: { key: string; at: number } | null = null;
  return (key: string): boolean => {
    const t = now();
    if (last && last.key === key && t - last.at < windowMs) { last.at = t; return false; }
    last = { key, at: t };
    return true;
  };
}

export type CameraProblem = 'insecure' | 'unsupported' | 'denied' | 'none' | 'busy' | 'other';

export const CAMERA_PROBLEM_TEXT: Record<CameraProblem, string> = {
  insecure: 'Bu bağlantı kamera erişimine uygun değil (https ya da localhost gerekir). Kodu aşağıya yapıştırarak devam edebilirsin.',
  unsupported: 'Bu tarayıcı kamera erişimini desteklemiyor. Kodu aşağıya yapıştırarak devam edebilirsin.',
  denied: 'Kamera izni verilmedi. Tarayıcı ayarlarından izin verebilir ya da kodu aşağıya yapıştırarak devam edebilirsin.',
  none: 'Bu cihazda kamera bulunamadı. Kodu aşağıya yapıştırarak devam edebilirsin.',
  busy: 'Kamera başka bir uygulama tarafından kullanılıyor. Kapatıp yeniden dene ya da kodu yapıştır.',
  other: 'Kamera açılamadı. Kodu aşağıya yapıştırarak devam edebilirsin.',
};

/** Maps a getUserMedia failure to a problem the screen can explain. */
export function classifyCameraError(e: unknown): CameraProblem {
  const name = (e as { name?: string } | null)?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'none';
  if (name === 'NotSupportedError') return 'unsupported';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'busy';
  return 'other';
}
