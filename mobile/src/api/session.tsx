import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from './client';
import { load, remove, save } from './storage';
import type { Company, Env, Me } from './types';

type Stored = { token: string | null; companyId: string | null; userId?: string | null };

type Session = {
  ready: boolean;
  env: Env | null;
  token: string | null;
  /** Kept on the device so queued records can be matched to their author even when the app starts offline. */
  userId: string | null;
  me: Me | null;
  companies: Company[];
  company: Company | null;
  siteId: string | null;
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

  const persist = useCallback((s: Stored) => { setStored(s); void save(KEY, s); }, []);

  const loadAccount = useCallback(async (token: string) => {
    const [m, c] = await Promise.all([api<Me>('GET', '/me', { token }), api<Company[]>('GET', '/companies', { token })]);
    setMe(m);
    setCompanies(c);
    return { m, c };
  }, []);

  useEffect(() => {
    (async () => {
      const s = await load<Stored>(KEY, { token: null, companyId: null });
      setStored(s);
      try { setEnv(await api<Env>('GET', '/env')); } catch { /* offline: env unknown until next start */ }
      if (s.token) {
        try { await loadAccount(s.token); }
        catch (e) {
          // An expired session signs out; an offline start keeps the token and cached screens.
          if (e instanceof ApiError && e.status === 401) { await remove(KEY); setStored({ token: null, companyId: null }); }
        }
      }
      setReady(true);
    })();
  }, [loadAccount]);

  const value = useMemo<Session>(() => {
    const company = companies.find(c => c.id === stored.companyId) ?? companies[0] ?? null;
    const role = company?.roles[0]?.role ?? null;
    const siteId = company ? (company.roles.find(r => r.siteId)?.siteId ?? company.sites[0]?.id ?? null) : null;
    const call = <T,>(method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, body?: unknown, idempotencyKey?: string) =>
      api<T>(method, path, { token: stored.token, body, idempotencyKey });

    const finish = async (token: string) => {
      const { m, c } = await loadAccount(token);
      persist({ token, companyId: c[0]?.id ?? null, userId: m.userId });
    };

    return {
      ready, env, token: stored.token, userId: me?.userId ?? stored.userId ?? null, me, companies, company, siteId, role,
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
        setMe(null); setCompanies([]);
        persist({ token: null, companyId: null, userId: null });
      },
      refresh: async () => { if (stored.token) await loadAccount(stored.token); },
      selectCompany: id => persist({ ...stored, companyId: id }),
      createCompany: async (name, siteName) => {
        const r = await call<{ companyId: string; siteId: string }>('POST', '/companies', { name, siteName, timezone: 'Europe/Istanbul' });
        await loadAccount(stored.token!);
        persist({ ...stored, companyId: r.companyId });
        return r;
      },
      call,
    };
  }, [ready, env, stored, me, companies, loadAccount, persist]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used inside <SessionProvider>');
  return v;
}
