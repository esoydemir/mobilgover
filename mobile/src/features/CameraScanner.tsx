import { createElement, useEffect, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { C, type } from '../theme';
import { CAMERA_PROBLEM_TEXT, classifyCameraError, decodeFrame, onceWithin, tokenFromText, type CameraProblem } from './qr-scan';

/**
 * Live camera reading in the browser (getUserMedia + frame decoding). The stream is stopped when the component unmounts or when a code has
 * been accepted; the same code seen in consecutive frames is reported once. When the camera cannot be used the parent keeps the code entry.
 */
export function CameraScanner({ onToken, onProblem, onUnreadable }: { onToken: (token: string) => void; onProblem: (p: CameraProblem) => void; onUnreadable?: () => void }) {
  const videoRef = useRef<any>(null);
  const [state, setState] = useState<'starting' | 'live'>('starting');
  const cb = useRef({ onToken, onProblem, onUnreadable });
  cb.current = { onToken, onProblem, onUnreadable };

  useEffect(() => {
    if (Platform.OS !== 'web') { cb.current.onProblem('unsupported'); return; }
    const nav: any = typeof navigator !== 'undefined' ? navigator : null;
    if (typeof window !== 'undefined' && window.isSecureContext === false) { cb.current.onProblem('insecure'); return; }
    if (!nav?.mediaDevices?.getUserMedia) { cb.current.onProblem('unsupported'); return; }
    let stopped = false; let stream: MediaStream | null = null; let timer: any = null;
    const once = onceWithin(4000);
    const stop = () => { stopped = true; if (timer) clearInterval(timer); stream?.getTracks().forEach(t => t.stop()); stream = null; const v = videoRef.current; if (v) v.srcObject = null; };
    (async () => {
      try {
        stream = await nav.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
        if (stopped) { stream?.getTracks().forEach(t => t.stop()); return; }
        const v = videoRef.current; if (!v) { stop(); return; }
        v.srcObject = stream; v.setAttribute('playsinline', 'true'); v.muted = true;
        await v.play().catch(() => undefined);
        setState('live');
        const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D | null;
        timer = setInterval(() => {
          if (stopped || !ctx || !v.videoWidth) return;
          const w = Math.min(v.videoWidth, 640), h = Math.round(v.videoHeight * (w / v.videoWidth));
          canvas.width = w; canvas.height = h; ctx.drawImage(v, 0, 0, w, h);
          const text = decodeFrame(ctx.getImageData(0, 0, w, h).data, w, h);
          if (!text) return;
          const token = tokenFromText(text);
          if (token && once(token)) cb.current.onToken(token);
          // B-14: something was read but it is not a GoverHub code (damaged or foreign): say so once, keep scanning.
          else if (!token && once(`bad:${text}`)) cb.current.onUnreadable?.();
        }, 250);
      } catch (e) { if (!stopped) cb.current.onProblem(classifyCameraError(e)); }
    })();
    return stop;
  }, []);

  return (
    <View testID="camera-scanner" style={{ borderRadius: 16, overflow: 'hidden', backgroundColor: '#000', aspectRatio: 1, width: '100%' }}>
      {createElement('video', { ref: videoRef, style: { width: '100%', height: '100%', objectFit: 'cover' }, playsInline: true, muted: true, 'aria-label': 'Kamera görüntüsü' })}
      {state === 'starting' ? <Text style={[type(12, 500, { color: C.t2 }), { position: 'absolute', left: 12, top: 12 }]}>Kamera açılıyor…</Text> : null}
    </View>
  );
}

export { CAMERA_PROBLEM_TEXT };
