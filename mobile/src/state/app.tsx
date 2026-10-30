import { router, type Href } from 'expo-router';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { TASKS, type Persona } from '../data';

export type SheetKey = 'calc' | 'why' | 'ncr' | 'ai' | 'search' | 'quote' | 'training' | 'fault';
export type ToastKind = 'ok' | 'warn';
export type Toast = { id: number; title: string; body: string; kind: ToastKind };

type AppState = {
  persona: Persona;
  setPersona: (p: Persona) => void;
  /** Completed task ids, shared by the home list, the task list and task detail. */
  done: Record<string, boolean>;
  toggleTask: (id: string) => void;
  completeTask: (id: string) => void;
  doneCount: number;
  trained: boolean;
  setTrained: (v: boolean) => void;
  sheet: SheetKey | null;
  openSheet: (k: SheetKey) => void;
  closeSheet: () => void;
  toast: Toast | null;
  showToast: (title: string, body?: string, kind?: ToastKind) => void;
};

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [persona, setPersonaRaw] = useState<Persona>('owner');
  const [done, setDone] = useState<Record<string, boolean>>({ t2: true });
  const [trained, setTrained] = useState(false);
  const [sheet, setSheet] = useState<SheetKey | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showToast = useCallback((title: string, body = '', kind: ToastKind = 'ok') => {
    clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), title, body, kind });
    toastTimer.current = setTimeout(() => setToast(null), 3400);
  }, []);

  const setPersona = useCallback((p: Persona) => {
    setPersonaRaw(p);
    setSheet(null);
    goRoot('/');
  }, []);

  const value = useMemo<AppState>(() => {
    // The ring counts today's and overdue items plus one already-closed daily check.
    const doneCount = TASKS.filter(t => done[t.id] && t.bucket !== 'upcoming').length + 1;
    return {
      persona, setPersona,
      done,
      toggleTask: id => setDone(d => ({ ...d, [id]: !d[id] })),
      completeTask: id => setDone(d => ({ ...d, [id]: true })),
      doneCount,
      trained, setTrained,
      sheet, openSheet: setSheet, closeSheet: () => setSheet(null),
      toast, showToast,
    };
  }, [persona, setPersona, done, trained, sheet, toast, showToast]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppProvider>');
  return v;
}

/** Clears the stack and shows `href` as the only screen (tab bar behaviour). */
export function goRoot(href: Href) {
  if (router.canDismiss()) router.dismissAll();
  router.replace(href);
}

/** Back with the prototype's fallback: an empty stack returns to home. */
export function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
