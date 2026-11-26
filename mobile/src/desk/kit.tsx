import { Fragment, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApi } from '../api/useApi';
import { Icon } from './icons';

/* ───────── tema ve bildirim ───────── */
type Mode = 'light' | 'dark';
const Ctx = createContext<{ mode: Mode; setMode: (m: Mode) => void; toast: (m: string) => void }>({ mode: 'light', setMode: () => undefined, toast: () => undefined });
export const useDesk = () => useContext(Ctx);
const readMode = (): Mode => { try { const v = globalThis.localStorage?.getItem('gh.desk.theme'); if (v === 'dark' || v === 'light') return v; } catch { /* tarayıcı depolaması yok */ } return 'light'; };
export function DeskProvider({ children }: { children: ReactNode }) {
  const [mode, setModeS] = useState<Mode>('light'); const [msg, setMsg] = useState<string | null>(null); const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { setModeS(readMode()); }, []);
  const setMode = useCallback((m: Mode) => { setModeS(m); try { globalThis.localStorage?.setItem('gh.desk.theme', m); } catch { /* sessiz */ } }, []);
  const toast = useCallback((m: string) => { setMsg(m); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(null), 4200); }, []);
  const v = useMemo(() => ({ mode, setMode, toast }), [mode, setMode, toast]);
  return <Ctx.Provider value={v}>{children}<div role="status" aria-live="polite">{msg ? <div className="gh-toast" data-testid="desk-toast">{msg}</div> : null}</div></Ctx.Provider>;
}

/* ───────── yönetim işleri (sayaçlar) ───────── */
export type WorkItem = { id: string; kind: string; title: string; waitingMinutes: number; responsible: string; status: string; action: string; href: string; mine?: boolean };
export type Counter = { key: string; label: string; count: number; href: string; kind?: 'decision' | 'follow_up' };
export type Area = { area: 'legislation' | 'market' | 'moderation'; label: string; need: string; state: 'ok' | 'forbidden' | 'error'; message?: string; counters: Counter[]; items: WorkItem[]; total: number };
export type Work = { generatedAt: string; yourRoles: string[]; areas: Area[]; missing: { key: string; label: string; why: string }[] };
const WorkCtx = createContext<{ work: Work | null; error: string | null; loading: boolean; reload: () => Promise<void> }>({ work: null, error: null, loading: false, reload: async () => undefined });
export const useWork = () => useContext(WorkCtx);
export function WorkProvider({ active, children }: { active: boolean; children: ReactNode }) {
  const q = useApi<Work>(active ? '/admin/work' : null);
  useEffect(() => {
    if (!active) return;
    const again = () => { void q.reload(); }; const t = setInterval(again, 60_000); window.addEventListener('focus', again);
    return () => { clearInterval(t); window.removeEventListener('focus', again); };
  }, [q.reload, active]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = useMemo(() => ({ work: q.data, error: q.error, loading: q.loading, reload: q.reload }), [q.data, q.error, q.loading, q.reload]);
  return <WorkCtx.Provider value={v}>{children}</WorkCtx.Provider>;
}

/* ───────── küçük bileşenler ───────── */
export function Btn({ children, kind, size, onClick, disabled, testid, title, type = 'button', ariaLabel, className = '' }:
  { children: ReactNode; kind?: 'pri' | 'dng' | 'ghost'; size?: 'sm'; onClick?: () => void; disabled?: boolean; testid?: string; title?: string; type?: 'button' | 'submit'; ariaLabel?: string; className?: string }) {
  return <button type={type} className={`gh-btn ${kind ?? ''} ${size ?? ''} ${className}`} onClick={onClick} disabled={disabled} data-testid={testid} title={title} aria-label={ariaLabel}>{children}</button>;
}
export const Badge = ({ tone, children }: { tone?: 'crit' | 'warn' | 'info' | 'ok' | 'ex'; children: ReactNode }) => <span className={`gh-badge ${tone ?? ''}`}>{children}</span>;
export function Seg<T extends string>({ value, onChange, items, label, testid }: { value: T; onChange: (v: T) => void; items: { key: T; label: string; n?: number }[]; label: string; testid?: string }) {
  return (
    <div className="gh-seg" role="group" aria-label={label} data-testid={testid}>
      {items.map(i => <button key={i.key} type="button" aria-pressed={value === i.key} data-testid={`${testid ?? 'seg'}-${i.key}`} onClick={() => onChange(i.key)}>{i.label}{i.n !== undefined ? <span className="n">{i.n}</span> : null}</button>)}
    </div>
  );
}
export function Search({ value, onChange, placeholder, label, testid }: { value: string; onChange: (v: string) => void; placeholder: string; label: string; testid?: string }) {
  return <div className="gh-search"><Icon name="search" size={16} /><input type="search" aria-label={label} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} data-testid={testid} /></div>;
}
export function Field({ label, value, onChange, hint, multiline, placeholder, testid, type = 'text', disabled }: { label: string; value: string; onChange: (v: string) => void; hint?: string; multiline?: boolean; placeholder?: string; testid?: string; type?: string; disabled?: boolean }) {
  const id = useRef(`f${Math.random().toString(36).slice(2, 8)}`).current;
  return (
    <div className="gh-field">
      <label htmlFor={id}>{label}</label>
      {multiline ? <textarea id={id} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} data-testid={testid} disabled={disabled} aria-describedby={hint ? `${id}h` : undefined} />
        : <input id={id} type={type} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} data-testid={testid} disabled={disabled} aria-describedby={hint ? `${id}h` : undefined} />}
      {hint ? <span className="hint" id={`${id}h`}>{hint}</span> : null}
    </div>
  );
}
export const Callout = ({ tone, children, testid }: { tone?: 'warn' | 'crit' | 'info' | 'ok'; children: ReactNode; testid?: string }) => <div className={`gh-callout ${tone ?? ''}`} data-testid={testid}>{children}</div>;
export const Section = ({ no, title, children, testid }: { no?: number; title: string; children: ReactNode; testid?: string }) => <section className="gh-sec" data-testid={testid}><h3>{no ? <span className="no">{no}</span> : null}{title}</h3>{children}</section>;
export const Kv = ({ rows }: { rows: [string, ReactNode][] }) => <dl className="gh-kv">{rows.filter(r => r[1] !== null && r[1] !== undefined && r[1] !== false).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>;
export const Ext = ({ href, children }: { href: string; children: ReactNode }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}<span className="gh-sr"> (yeni sekmede açılır)</span> <Icon name="ext" size={13} /></a>;

/* ───────── dört ayrı durum: yükleniyor / sıfır kayıt / erişim kısıtlı / bağlantı hatası ───────── */
export function Loading({ what }: { what: string }) {
  return <div role="status" aria-live="polite" data-testid="state-loading" style={{ padding: '14px 0' }}><div className="gh-pre" style={{ padding: '10px 22px' }}><span className="gh-spin" />{what} yükleniyor…</div><div className="gh-skel" style={{ width: '70%' }} /><div className="gh-skel" style={{ width: '55%' }} /><div className="gh-skel" style={{ width: '62%' }} /></div>;
}
export function Zero({ title, text, children }: { title: string; text?: string; children?: ReactNode }) {
  return <div className="gh-state" data-testid="state-zero"><h2><span style={{ color: 'var(--green)', marginRight: 8 }}><Icon name="check" size={16} /></span>{title}</h2>{text ? <p>{text}</p> : null}{children}</div>;
}
export function Locked({ what, need }: { what: string; need: string }) {
  return <div className="gh-state lock" data-testid="state-locked" role="alert"><h2><span style={{ marginRight: 8 }}><Icon name="lock" size={16} /></span>{what}: erişim kısıtlı</h2><p>Bu alan için hesabında gerekli rol yok. Gerekli rol: {need}. Bu bir hata değil; yetki bir platform yöneticisi tarafından verilir.</p></div>;
}
export function Failed({ what, message, onRetry }: { what: string; message: string; onRetry?: () => void }) {
  return <div className="gh-state err" data-testid="state-error" role="alert"><h2><span style={{ marginRight: 8 }}><Icon name="alert" size={16} /></span>{what} yüklenemedi</h2><p>{message} Bu, kayıt olmadığı anlamına gelmez; yeniden dene.</p>{onRetry ? <Btn onClick={onRetry} testid="state-retry">Yeniden dene</Btn> : null}</div>;
}

/* ───────── zaman ───────── */
export const waitLabel = (min: number) => (min < 60 ? `${min} dk` : min < 1440 ? `${Math.floor(min / 60)} sa` : `${Math.floor(min / 1440)} gün`);
export const waitFrom = (iso: string | null | undefined) => (iso ? waitLabel(Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))) : '—');
export const dayTr = (d: string | null | undefined) => { if (!d) return '—'; const s = String(d).slice(0, 10).split('-'); return s.length === 3 ? `${s[2]}.${s[1]}.${s[0]}` : String(d); };
export const dateTimeTr = (iso: string | null | undefined) => { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : `${d.toLocaleDateString('tr-TR')} ${d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`; };

/* ───────── adres + oturum belleği: süzgeç, arama, seçili kayıt ve kaydırma konumu çalışma alanından çıkınca da korunur ───────── */
const KEEP = 'gh.desk.keep.';
const readKept = (ws: string): Record<string, string> => { try { return JSON.parse(globalThis.sessionStorage?.getItem(KEEP + ws) ?? '{}'); } catch { return {}; } };
export function useWsState(ws: string, defaults: Record<string, string>) {
  const [st, setSt] = useState<Record<string, string>>(() => {
    const url = new URLSearchParams(globalThis.location?.search ?? ''); const kept = readKept(ws); const out: Record<string, string> = { ...defaults };
    const fromUrl = [...url.keys()].some(k => k in defaults || k === 'sel');
    for (const k of [...Object.keys(defaults), 'sel']) { const v = fromUrl ? url.get(k) : kept[k]; if (v !== null && v !== undefined) out[k] = v; else if (k === 'sel') out[k] = ''; }
    // adreste hiç parametre yoksa (kenar çubuğundan gelindi) son kullanılan durum geri yüklenir
    return out;
  });
  const set = useCallback((patch: Record<string, string>) => {
    setSt(prev => {
      const next = { ...prev, ...patch };
      try {
        const u = new URLSearchParams(); for (const [k, v] of Object.entries(next)) if (v && v !== defaults[k]) u.set(k, v);
        globalThis.history.replaceState(globalThis.history.state, '', `${globalThis.location.pathname}${u.toString() ? `?${u}` : ''}`);
        globalThis.sessionStorage?.setItem(KEEP + ws, JSON.stringify({ ...readKept(ws), ...next }));
      } catch { /* adres çubuğu ya da depolama yoksa durum yine de bellekte kalır */ }
      return next;
    });
  }, [ws]); // eslint-disable-line react-hooks/exhaustive-deps
  return [st, set] as const;
}
export function useScrollKeep(ws: string, ref: React.RefObject<HTMLElement | null>, ready: boolean) {
  const done = useRef(false);
  useLayoutEffect(() => {
    if (!ready || done.current || !ref.current) return; done.current = true;
    try { const y = Number(globalThis.sessionStorage?.getItem(`${KEEP}${ws}.y`) ?? 0); if (y > 0) ref.current.scrollTop = y; } catch { /* sessiz */ }
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  return () => { try { if (ref.current) globalThis.sessionStorage?.setItem(`${KEEP}${ws}.y`, String(ref.current.scrollTop)); } catch { /* sessiz */ } };
}

/* ───────── liste + sağ ayrıntı paneli ───────── */
export type Col<R> = { key: string; label: string; w: string; render: (r: R) => ReactNode; dim?: boolean; opt?: boolean };
export function ListDetail<R>({ ws, label, rows, rowId, cols, selId, onSelect, panel, panelTitle, ready, empty, footer }: {
  ws: string; label: string; rows: R[]; rowId: (r: R) => string; cols: Col<R>[]; selId: string; onSelect: (id: string) => void; panel: ReactNode; panelTitle?: string; ready: boolean; empty: ReactNode; footer?: ReactNode;
}) {
  const grid = cols.map(c => c.w).join(' '); const gridC = cols.filter(c => !c.opt).map(c => c.w).join(' ');
  const gstyle = { ['--cols' as string]: grid, ['--colsc' as string]: gridC, gridTemplateColumns: 'var(--cols)' } as React.CSSProperties; const listRef = useRef<HTMLDivElement>(null); const panelRef = useRef<HTMLDivElement>(null); const save = useScrollKeep(ws, listRef, ready && rows.length > 0);
  const [focusId, setFocusId] = useState<string>(''); const lastFocus = useRef('');
  const ids = rows.map(rowId); const tab = ids.includes(focusId) ? focusId : ids.includes(selId) ? selId : ids[0] ?? '';
  const focusRow = (id: string) => { setFocusId(id); requestAnimationFrame(() => { listRef.current?.querySelector<HTMLElement>(`[data-rid="${CSS.escape(id)}"]`)?.focus(); }); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return; const i = ids.indexOf((e.target as HTMLElement).getAttribute('data-rid') ?? '');
    const go = (n: number) => { e.preventDefault(); const t = ids[Math.max(0, Math.min(ids.length - 1, n))]; if (t) focusRow(t); };
    if (e.key === 'ArrowDown') go(i + 1); else if (e.key === 'ArrowUp') go(i - 1); else if (e.key === 'Home') go(0); else if (e.key === 'End') go(ids.length - 1);
  };
  const close = () => { const id = selId; onSelect(''); if (id) { lastFocus.current = id; focusRow(id); } };
  // Esc: ayrıntıyı kapatır ve odak geldiği satıra döner. Yazı alanındayken de çalışır; taslaklar kayıt başına tutulur.
  useEffect(() => {
    if (!selId) return; const h = (e: KeyboardEvent) => { if (!listRef.current?.offsetParent && !panelRef.current?.offsetParent) return; if (e.key === 'Escape' && !e.defaultPrevented && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); close(); } };
    document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h);
  }, [selId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="gh-work" data-testid={`${ws}-work`} data-panel={selId ? 'open' : 'closed'}>
      <div className="gh-listwrap">
        <div className="gh-rowhead" style={gstyle} aria-hidden="true">{cols.map(c => <div key={c.key} data-opt={c.opt ? '1' : undefined}>{c.label}</div>)}</div>
        <div className="gh-list" ref={listRef} onScroll={save} role="listbox" aria-label={label} aria-activedescendant={undefined} onKeyDown={onKey} data-testid={`${ws}-list`}>
          {rows.length === 0 ? empty : rows.map(r => {
            const id = rowId(r); const sel = id === selId;
            return (
              <button key={id} type="button" role="option" aria-selected={sel} tabIndex={id === tab ? 0 : -1} data-rid={id} data-testid={`${ws}-row-${id}`} className="gh-row" style={gstyle}
                onFocus={() => setFocusId(id)} onClick={e => { onSelect(id); if (e.detail === 0) requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>('[data-panel-title]')?.focus()); }}>
                {cols.map(c => <div key={c.key} data-opt={c.opt ? '1' : undefined} className={`gh-cell ${c.dim ? 'dim' : ''}`}>{c.render(r)}</div>)}
              </button>
            );
          })}
          {footer}
        </div>
        <div className="gh-kbd"><kbd>↑</kbd> <kbd>↓</kbd> satır seç · <kbd>Enter</kbd> ayrıntıyı aç · <kbd>Esc</kbd> kapat ve satıra dön</div>
      </div>
      {selId ? (
        <aside className="gh-panel" ref={panelRef} aria-label={panelTitle ?? 'Kayıt ayrıntısı'} data-testid={`${ws}-panel`}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 10px 0' }}>
            <button type="button" className="gh-btn ghost sm gh-back" onClick={close} data-testid="panel-back" style={{ marginRight: 'auto' }}><Icon name="back" size={15} /> Listeye dön</button>
            <button type="button" className="gh-btn ghost sm gh-iconbtn" onClick={close} aria-label="Ayrıntıyı kapat (Esc)" title="Kapat (Esc)" data-testid="panel-close" style={{ width: 30, minHeight: 30 }}><Icon name="x" size={16} /></button>
          </div>
          {panel}
        </aside>
      ) : null}
    </div>
  );
}
/** Her ayrıntı panelinin başında aynı iki soru: neden bekliyor, bu hesapla şimdi ne yapılabilir. */
export const NowBox = ({ title = 'Neden bekliyor', why, can, note, testid, children }: { title?: string; why: ReactNode; can?: string[] | null; note?: ReactNode; testid: string; children?: ReactNode }) => (
  <div className="gh-now" data-testid={testid}><h3>{title}</h3><p data-testid={`${testid}-why`}>{why}</p>
    {can ? <><h3 style={{ marginTop: 10 }}>Bu hesapla şimdi yapabileceğin</h3>{can.length ? <ul data-testid={`${testid}-can`}>{can.map(t => <li key={t}>{t}</li>)}</ul> : <p data-testid={`${testid}-can`}>Bu kayıtta bu hesapla yapılabilecek işlem yok.</p>}</> : null}
    {note ? <p className="gh-note">{note}</p> : null}{children}</div>
);
export const PanelHead = ({ eyebrow, title, badges }: { eyebrow?: ReactNode; title: string; badges?: ReactNode }) => (
  <div className="gh-panel-head" style={{ paddingTop: 4 }}><div style={{ minWidth: 0 }}>{eyebrow ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>{eyebrow}</div> : null}<h2 tabIndex={-1} data-panel-title="1" data-testid="panel-title">{title}</h2>{badges ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>{badges}</div> : null}</div></div>
);
