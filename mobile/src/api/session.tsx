import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from './client';
import { load, remove, save } from './storage';
import type { Company, Env, Me } from './types';

type Stored = { token: string | null; companyId: string | null; userId?: string | null; siteId?: string | null; provider?: boolean | null };

type Session = {
  ready: boolean;
  env: Env | null;
  token: string | null;
  /** Kept on the device so queued records can be matched to their author even when the app starts offline. */
  userId: string | null;
  me: Me | null;
  /** True when the person has no business but has a professional (provider) profile: their home is the provider area.
   *  null = not known yet (the profile could not be fetched, e.g. offline): never send them to business setup meanwhile. */
  provider: boolean | null;
  companies: Company[];
  company: Company | null;
  siteId: string | null;
  /** Sites this person works in: a site-scoped member only their own; company-wide roles all. */
  sites: { id: string; name: string }[];
  selectSite: (id: string) => void;
  /** Role in the selected company (first one wins if several). */
  role: Me['memberships'][number]['role'] | null;
  startLogin: (email: string) => Promise<void>;
  verifyLogin: (email: string, code: string) => Promise<{ mfaTicket?: string }>;
  verifyMfa: (ticket: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  selectCompany: (id: string) => void;
  createCompany: (name: string, siteName: string) => Promise<{ companyId: string; siteId: string }>;
  call: <T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, body?: unknown, idempotencyKey?: string) => Promise<T>;
};

const Ctx = createContext<Session | null>(null);
const KEY = 'gh.session.v1';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [env, setEnv] = useState<Env | null>(null);
  const [stored, setStored] = useState<Stored>({ token: null, companyId: null });
  const [me, setMe] = useState<Me | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [provider, setProvider] = useState<boolean | null>(null);

  const persist = useCallback((s: Stored) => { setStored(s); void save(KEY, s); }, []);

  const loadAccount = useCallback(async (token: string, hint: boolean | null = null) => {
    const [m, c] = await Promise.all([api<Me>('GET', '/me', { token }), api<Company[]>('GET', '/companies', { token })]);
    // Someone with no business but a professional profile belongs in the provider area, not the business setup.
    // If the profile cannot be fetched (offline), keep what the device last knew (or "unknown") instead of guessing "no".
    let p: boolean | null = c.length === 0 ? hint : false;
    if (c.length === 0) {
      try { p = !!(await api<unknown>('GET', '/pro/profile', { token })); } catch { /* unknown: retried when the connection returns */ }
    }
    setProvider(p);
    setMe(m);
    setCompanies(c);
    return { m, c, p };
  }, []);

  useEffect(() => {
    (async () => {
      const s = await load<Stored>(KEY, { token: null, companyId: null });
      setStored(s);
      setProvider(s.provider ?? null);
      try { setEnv(await api<Env>('GET', '/env')); } catch { /* offline: env unknown until next start */ }
      if (s.token) {
        try { const r = await loadAccount(s.token, s.provider ?? null); if (r.p !== (s.provider ?? null)) persist({ ...s, provider: r.p }); }
        catch (e) {
          // An expired session signs out; an offline start keeps the token and cached screens.
          if (e instanceof ApiError && e.status === 401) { await remove(KEY); setStored({ token: null, companyId: null }); }
        }
      }
      setReady(true);
    })();
  }, [loadAccount, persist]);

  // Signed in but the account (or the professional profile) is still unknown, e.g. the app opened offline:
  // try again on a timer and the moment the browser/phone says the connection is back.
  const token = stored.token;
  const needsAccount = ready && !!token && (!me || (companies.length === 0 && provider === null));
  useEffect(() => {
    if (!needsAccount || !token) return;
    let stop = false;
    const attempt = async () => {
      try {
        const r = await loadAccount(token, provider);
        if (!stop && r.p !== provider) persist({ ...stored, provider: r.p });
      } catch (e) {
        if (e instanceof ApiError && e.status === 401 && !stop) { await remove(KEY); setStored({ token: null, companyId: null }); }
      }
    };
    const timer = setInterval(attempt, 5000);
    const g = globalThis as { addEventListener?: (n: string, f: () => void) => void; removeEventListener?: (n: string, f: () => void) => void };
    g.addEventListener?.('online', attempt);
    return () => { stop = true; clearInterval(timer); g.removeEventListener?.('online', attempt); };
  }, [needsAccount, token, provider, stored, loadAccount, persist]);

  const value = useMemo<Session>(() => {
    const company = companies.find(c => c.id === stored.companyId) ?? companies[0] ?? null;
    const role = company?.roles[0]?.role ?? null;
    const fixedSite = company?.roles.find(r => r.siteId)?.siteId ?? null;
    const companyWide = !!company?.roles.some(r => !r.siteId);
    const sites = company ? company.sites.filter(s => companyWide || s.id === fixedSite || (!company.roles.length)) : [];
    const siteId = company ? (!companyWide && fixedSite ? fixedSite
      : sites.find(s => s.id === stored.siteId)?.id ?? fixedSite ?? company.sites[0]?.id ?? null) : null;
    const call = <T,>(method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, body?: unknown, idempotencyKey?: string) =>
      api<T>(method, path, { token: stored.token, body, idempotencyKey });

    const finish = async (token: string) => {
      const { m, c, p } = await loadAccount(token);
      persist({ token, companyId: c[0]?.id ?? null, userId: m.userId, provider: p });
    };

    return {
      ready, env, token: stored.token, userId: me?.userId ?? stored.userId ?? null, me, provider, companies, company, siteId, sites, role,
      selectSite: id => persist({ ...stored, siteId: id }),
      startLogin: async email => { await api('POST', '/auth/email/start', { body: { email } }); },
      verifyLogin: async (email, code) => {
        const r = await api<{ mfaRequired: boolean; token?: string; ticket?: string }>('POST', '/auth/email/verify', { body: { email, code } });
        if (r.mfaRequired) return { mfaTicket: r.ticket };
        await finish(r.token!);
        return {};
      },
      verifyMfa: async (ticket, code) => {
        const r = await api<{ token: string }>('POST', '/auth/mfa/verify', { body: { ticket, code } });
        await finish(r.token);
      },
      logout: async () => {
        try { await call('POST', '/auth/logout'); } catch { /* sign out locally anyway */ }
        setMe(null); setCompanies([]); setProvider(null);
        persist({ token: null, companyId: null, userId: null, provider: null });
      },
      refresh: async () => { if (stored.token) await loadAccount(stored.token); },
      selectCompany: id => persist({ ...stored, companyId: id, siteId: null }),
      createCompany: async (name, siteName) => {
        const r = await call<{ companyId: string; siteId: string }>('POST', '/companies', { name, siteName, timezone: 'Europe/Istanbul' });
        await loadAccount(stored.token!);
        persist({ ...stored, companyId: r.companyId });
        return r;
      },
      call,
    };
  }, [ready, env, stored, me, provider, companies, loadAccount, persist]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used inside <SessionProvider>');
  return v;
}
