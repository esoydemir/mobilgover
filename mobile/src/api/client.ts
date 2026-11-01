/**
 * HTTP client for the GoverHub API. The base URL comes from the build
 * environment (EXPO_PUBLIC_API_URL), so demo and pilot builds point at
 * different servers and never mix data.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

import { ApiError, NetworkError } from './errors';

export { ApiError, NetworkError };

export type Options = { token?: string | null; body?: unknown; idempotencyKey?: string; bytes?: { data: Uint8Array; mime: string } };
export type Api = <T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, o?: Options) => Promise<T>;

/** A client for one server. Tests use it against a server started on a random port. */
export const makeApi = (baseUrl: string): Api => async <T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, o: Options = {}): Promise<T> => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  const headers: Record<string, string> = {};
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.idempotencyKey) headers['idempotency-key'] = o.idempotencyKey;
  let body: BodyInit | undefined;
  if (o.bytes) { headers['content-type'] = o.bytes.mime; body = o.bytes.data as unknown as BodyInit; }
  else if (o.body !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(o.body); }
  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, { method, headers, body, signal: ctrl.signal });
  } catch {
    throw new NetworkError('Sunucuya ulaşılamadı.');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  const json = text ? safeJson(text) : null;
  if (!res.ok) {
    const e = json?.error;
    throw new ApiError(res.status, e?.code ?? 'HTTP_' + res.status, e?.message ?? `Sunucu hatası (${res.status}).`, e?.details);
  }
  return json as T;
};

export const api: Api = makeApi(API_URL);

function safeJson(t: string) {
  try { return JSON.parse(t); } catch { return null; }
}

export const errorText = (e: unknown) =>
  e instanceof ApiError ? e.message : e instanceof NetworkError ? 'Bağlantı yok. Kayıt cihazda bekletilebilir.' : 'Beklenmeyen bir hata oluştu.';

export function newOpKey() {
  const r = () => Math.random().toString(36).slice(2, 10);
  return `op-${Date.now().toString(36)}-${r()}${r()}`;
}
