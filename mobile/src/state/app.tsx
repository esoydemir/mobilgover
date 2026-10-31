import { router, type Href } from 'expo-router';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export type ToastKind = 'ok' | 'warn';
export type Toast = { id: number; title: string; body: string; kind: ToastKind };

type UiState = { toast: Toast | null; showToast: (title: string, body?: string, kind?: ToastKind) => void };

const Ctx = createContext<UiState | null>(null);

/** UI-only state (toasts). Business data lives on the server and in the offline queue. */
export function UiProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showToast = useCallback((title: string, body = '', kind: ToastKind = 'ok') => {
    clearTimeout(timer.current);
    setToast({ id: Date.now(), title, body, kind });
    timer.current = setTimeout(() => setToast(null), 3400);
  }, []);
  const value = useMemo(() => ({ toast, showToast }), [toast, showToast]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUi() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUi must be used inside <UiProvider>');
  return v;
}

/** Clears the stack and shows `href` as the only screen (tab bar behaviour). */
export function goRoot(href: Href) {
  if (router.canDismiss()) router.dismissAll();
  router.replace(href);
}

/** Back with a fallback: an empty stack returns to home. */
export function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
