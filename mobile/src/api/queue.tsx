import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, newOpKey } from './client';
import { useSession } from './session';
import { load, save } from './storage';
import { SyncEngine, type DoneOp, type Op, type Saved } from './syncEngine';

export type { DoneOp, Op, OpStatus } from './syncEngine';

/**
 * React wrapper around the offline queue engine (see syncEngine.ts, which is
 * covered by integration tests against a real server). This file only adds
 * device storage, timers and re-rendering.
 */
type Queue = {
  ops: Op[];
  recent: DoneOp[];
  online: boolean | null;
  syncing: boolean;
  /** The session ended while records were waiting; they are sent after the user signs in again. */
  authRequired: boolean;
  enqueue: (o: Omit<Op, 'id' | 'userId' | 'createdAt' | 'status' | 'attempts' | 'method'>) => string;
  syncNow: () => Promise<void>;
  retry: (id: string) => void;
  discard: (id: string) => void;
  resultOf: (id: string) => DoneOp | undefined;
};

const Ctx = createContext<Queue | null>(null);
const KEY = 'gh.queue.v1';

export function QueueProvider({ children }: { children: ReactNode }) {
  const { token, userId } = useSession();
  const auth = useRef<{ token: string; userId: string } | null>(null);
  auth.current = token && userId ? { token, userId } : null;
  const [, setTick] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const backoff = useRef(5_000);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const engine = useMemo(() => new SyncEngine({
    transport: api,
    persist: { load: () => load<Saved | null>(KEY, null), save: s => save(KEY, s) },
    auth: () => auth.current,
    newKey: newOpKey,
    onChange: () => setTick(t => t + 1),
  }), []);

  const syncNow = async () => {
    if (!loaded) return;
    clearTimeout(timer.current);
    setSyncing(true);
    try {
      const r = await engine.syncNow();
      if (r.offline) {
        timer.current = setTimeout(() => void syncNow(), backoff.current);
        backoff.current = Math.min(backoff.current * 2, 60_000);
      } else backoff.current = 5_000;
    } finally { setSyncing(false); }
  };

  useEffect(() => { void engine.load().then(() => setLoaded(true)); }, [engine]);
  // Start, and resume after sign-in (a new session sends what an expired one could not).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (loaded) void syncNow(); }, [loaded, token, userId]);
  useEffect(() => {
    const id = setInterval(() => { if (engine.ops.some(o => o.status === 'pending')) void syncNow(); }, 15_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const value: Queue = {
    ops: engine.ops, recent: engine.recent, online: engine.online, syncing, authRequired: engine.authRequired,
    enqueue: o => { const id = engine.enqueue(o); setTimeout(() => void syncNow(), 0); return id; },
    syncNow,
    retry: id => { engine.retry(id); void syncNow(); },
    discard: id => engine.discard(id),
    resultOf: id => engine.resultOf(id),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useQueue() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useQueue must be used inside <QueueProvider>');
  return v;
}
