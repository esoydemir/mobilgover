import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, NetworkError, newOpKey } from './client';
import { useSession } from './session';
import { load, save } from './storage';

/**
 * Offline queue. Every write the user makes in the field goes here first,
 * is kept on the device, and is sent in order with a unique operation key
 * (the server answers a resend with the first result, so nothing is
 * duplicated). Failed and conflicting operations stay visible until the user
 * deals with them; nothing is dropped silently.
 */
export type OpStatus = 'pending' | 'syncing' | 'failed' | 'conflict';

export type Op = {
  id: string;
  companyId: string;
  taskId?: string;
  label: string;
  createdAt: string;
  method: 'POST';
  path: string;
  body: unknown;
  /** Photo/document: registered first, then its bytes are uploaded. */
  file?: { base64: string; mime: string; sha256: string; size: number };
  /** Set once the evidence record exists on the server, so a retry only re-sends the bytes. */
  evidenceId?: string;
  status: OpStatus;
  error?: string;
  attempts: number;
};

export type DoneOp = { id: string; label: string; doneAt: string; result?: any };

type Queue = {
  ops: Op[];
  recent: DoneOp[];
  online: boolean | null;
  syncing: boolean;
  enqueue: (o: Omit<Op, 'id' | 'createdAt' | 'status' | 'attempts' | 'method'>) => string;
  syncNow: () => Promise<void>;
  retry: (id: string) => void;
  discard: (id: string) => void;
  /** Results of completed operations, e.g. the outcome of a task completion. */
  resultOf: (id: string) => DoneOp | undefined;
};

const Ctx = createContext<Queue | null>(null);
const KEY = 'gh.queue.v1';

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function QueueProvider({ children }: { children: ReactNode }) {
  const { token } = useSession();
  const [ops, setOps] = useState<Op[]>([]);
  const [recent, setRecent] = useState<DoneOp[]>([]);
  const [online, setOnline] = useState<boolean | null>(null);
  const [syncing, setSyncing] = useState(false);
  const opsRef = useRef<Op[]>([]);
  const loaded = useRef(false);
  const running = useRef(false);
  const backoff = useRef(5_000);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const commit = useCallback((next: Op[]) => {
    opsRef.current = next;
    setOps(next);
    void save(KEY, { ops: next, recent: recentRef.current });
  }, []);
  const recentRef = useRef<DoneOp[]>([]);

  useEffect(() => {
    (async () => {
      const s = await load<{ ops: Op[]; recent: DoneOp[] }>(KEY, { ops: [], recent: [] });
      // An operation interrupted mid-send goes back to pending; its key makes the resend safe.
      opsRef.current = s.ops.map(o => (o.status === 'syncing' ? { ...o, status: 'pending' } : o));
      recentRef.current = s.recent;
      setOps(opsRef.current);
      setRecent(s.recent);
      loaded.current = true;
      void syncNow();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (id: string, patch: Partial<Op>) => commit(opsRef.current.map(o => (o.id === id ? { ...o, ...patch } : o)));

  const finish = (op: Op, result?: any) => {
    recentRef.current = [{ id: op.id, label: op.label, doneAt: new Date().toISOString(), result }, ...recentRef.current].slice(0, 30);
    setRecent(recentRef.current);
    commit(opsRef.current.filter(o => o.id !== op.id));
  };

  const send = async (op: Op) => {
    if (!op.file) return api('POST', op.path, { token, body: op.body, idempotencyKey: op.id });
    let evidenceId = op.evidenceId;
    if (!evidenceId) {
      const r = await api<{ id: string }>('POST', op.path, { token, body: op.body, idempotencyKey: op.id });
      evidenceId = r.id;
      update(op.id, { evidenceId });
    }
    try {
      return await api('PUT', `/companies/${op.companyId}/evidence/${evidenceId}/content`, { token, bytes: { data: b64ToBytes(op.file.base64), mime: op.file.mime } });
    } catch (e) {
      // Already stored by an earlier attempt whose answer was lost.
      if (e instanceof ApiError && e.code === 'EVIDENCE_NOT_PENDING') return { id: evidenceId, status: 'stored' };
      throw e;
    }
  };

  const syncNow = useCallback(async () => {
    if (!loaded.current || running.current || !token) return;
    running.current = true;
    setSyncing(true);
    clearTimeout(timer.current);
    try {
      for (const op of [...opsRef.current]) {
        if (op.status !== 'pending') continue;
        update(op.id, { status: 'syncing', attempts: op.attempts + 1 });
        try {
          const result = await send(opsRef.current.find(o => o.id === op.id)!);
          finish(op, result);
          setOnline(true);
          backoff.current = 5_000;
        } catch (e) {
          if (e instanceof NetworkError) {
            update(op.id, { status: 'pending', error: 'Bağlantı yok; tekrar denenecek.' });
            setOnline(false);
            timer.current = setTimeout(() => void syncNow(), backoff.current);
            backoff.current = Math.min(backoff.current * 2, 60_000);
            break;
          }
          const err = e as ApiError;
          const conflict = err.status === 409;
          update(op.id, { status: conflict ? 'conflict' : 'failed', error: err.message });
          setOnline(true);
        }
      }
    } finally {
      running.current = false;
      setSyncing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Periodic retry while something is waiting.
  useEffect(() => {
    const id = setInterval(() => { if (opsRef.current.some(o => o.status === 'pending')) void syncNow(); }, 15_000);
    return () => clearInterval(id);
  }, [syncNow]);

  const value = useMemo<Queue>(() => ({
    ops, recent, online, syncing,
    enqueue: o => {
      const id = newOpKey();
      commit([...opsRef.current, { ...o, id, method: 'POST', createdAt: new Date().toISOString(), status: 'pending', attempts: 0 }]);
      setTimeout(() => void syncNow(), 0);
      return id;
    },
    syncNow,
    retry: id => { update(id, { status: 'pending', error: undefined }); void syncNow(); },
    discard: id => commit(opsRef.current.filter(o => o.id !== id)),
    resultOf: id => recent.find(r => r.id === id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [ops, recent, online, syncing, syncNow, commit]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useQueue() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useQueue must be used inside <QueueProvider>');
  return v;
}
