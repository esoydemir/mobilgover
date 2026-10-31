import { useCallback, useEffect, useRef, useState } from 'react';
import { NetworkError, errorText } from './client';
import { useQueue } from './queue';
import { useSession } from './session';
import { load, save } from './storage';

/**
 * Reads from the API, with the last good answer cached on the device. When
 * offline the cached copy is shown and marked `stale`, so field staff can
 * still see today's tasks.
 */
export function useApi<T>(path: string | null) {
  const { call } = useSession();
  const { recent } = useQueue();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [stale, setStale] = useState(false);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!path) return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const d = await call<T>('GET', path);
      if (mine !== seq.current) return;
      setData(d); setError(null); setStale(false);
      void save(`gh.cache:${path}`, d);
    } catch (e) {
      if (mine !== seq.current) return;
      if (e instanceof NetworkError) {
        const cached = await load<T | null>(`gh.cache:${path}`, null);
        if (cached) { setData(cached); setStale(true); setError(null); }
        else setError(errorText(e));
      } else setError(errorText(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [path, call]);

  useEffect(() => { void reload(); }, [reload]);
  // Refresh after the queue delivers something, so screens show server truth.
  const lastDone = recent[0]?.id;
  useEffect(() => { if (lastDone) void reload(); }, [lastDone, reload]);

  return { data, error, loading, stale, reload, setData };
}
