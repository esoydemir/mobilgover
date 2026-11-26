import { router, usePathname } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { useSession } from '../api/session';
import { Icon, type IconName } from './icons';
import { DeskProvider, Locked, WorkProvider, useDesk, useWork } from './kit';
import { DESK_CSS } from './style';

export const ROLE_TR: Record<string, string> = { rule_author: 'Kural yazarı', rule_reviewer: 'Kural inceleyici', platform_admin: 'Platform yöneticisi', marketplace_reviewer: 'Pazar yeri inceleyicisi', network_moderator: 'Ağ moderatörü' };
type Nav = { key: string; path: string; label: string; icon: IconName; roles: string[] | null; area?: 'legislation' | 'market' | 'moderation'; need: string };
export const NAV: Nav[] = [
  { key: 'genel', path: '/admin', label: 'Genel Bakış', icon: 'home', roles: null, need: 'herhangi bir platform rolü' },
  { key: 'mevzuat', path: '/legislation', label: 'Mevzuat Masası', icon: 'scale', roles: ['platform_admin', 'rule_author', 'rule_reviewer'], area: 'legislation', need: 'platform yöneticisi, kural yazarı ya da kural inceleyici' },
  { key: 'pazar', path: '/pazar', label: 'Pazar Yönetimi', icon: 'store', roles: ['marketplace_reviewer'], area: 'market', need: 'pazar yeri inceleyicisi' },
  { key: 'moderasyon', path: '/moderation', label: 'Moderasyon', icon: 'flag', roles: ['network_moderator'], area: 'moderation', need: 'ağ moderatörü' },
  { key: 'kurallar', path: '/kurallar', label: 'Kural Sürümleri', icon: 'doc', roles: ['platform_admin', 'rule_author', 'rule_reviewer'], need: 'platform yöneticisi, kural yazarı ya da kural inceleyici' },
  { key: 'kullanicilar', path: '/kullanicilar', label: 'Kullanıcılar ve Yetkiler', icon: 'users', roles: ['platform_admin'], need: 'platform yöneticisi' },
  { key: 'denetim', path: '/denetim', label: 'Denetim Geçmişi', icon: 'history', roles: ['platform_admin'], need: 'platform yöneticisi' },
];
export const allowed = (roles: string[], n: Nav) => !n.roles || n.roles.some(r => roles.includes(r));

let injected = false;
function useCss(active: boolean) { useEffect(() => { if (!active || injected || typeof document === 'undefined') return; injected = true; const s = document.createElement('style'); s.id = 'gh-desk-css'; s.textContent = DESK_CSS; document.head.appendChild(s); }, [active]); }

/**
 * Kalıcı kenar çubuğu + içerik. Kullanıcı yalnız kendi rolüyle açabildiği çalışma alanlarını görür; her başlık gerçek bir çalışma alanına gider.
 * Ağaç yapısı etkin / etkin değil durumunda aynıdır (gezgin yeniden kurulmaz); etkin değilken kabuk görünmez ve ağ isteği yapmaz.
 */
export function DeskShell({ active, children }: { active: boolean; children: ReactNode }) {
  if (Platform.OS !== 'web') return <>{children}</>;
  return <DeskProvider><WorkProvider active={active}><Frame active={active}>{children}</Frame></WorkProvider></DeskProvider>;
}

function Frame({ active, children }: { active: boolean; children: ReactNode }) {
  useCss(active);
  const { me, logout } = useSession(); const { mode, setMode } = useDesk(); const { work } = useWork(); const path = usePathname();
  const roles = me?.platformRoles ?? [];
  const go = (e: React.MouseEvent, to: string) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); router.push(to as never); };
  const count = (n: Nav) => { const a = work?.areas.find(x => x.area === n.area); return a && a.state === 'ok' ? a.total : null; };
  return (
    <div className={active ? 'gh' : undefined} style={active ? undefined : { display: 'contents' }} data-theme={mode} data-testid={active ? 'desk' : undefined}>
      {active ? <nav className="gh-side" aria-label="Yönetim çalışma alanları">
        <div className="gh-brand"><div className="gh-logo" aria-hidden="true">G</div><div><b>GoverHub</b><small>Platform yönetimi</small></div></div>
        <div className="gh-nav">
          <div className="gh-navlabel">Çalışma alanları</div>
          {NAV.filter(n => allowed(roles, n)).map(n => {
            const on = path === n.path || (n.path !== '/admin' && path.startsWith(`${n.path}/`)); const c = count(n);
            return (
              <a key={n.key} href={n.path} aria-current={on ? 'page' : undefined} data-testid={`nav-${n.key}`} onClick={e => go(e, n.path)} title={n.label} aria-label={c ? `${n.label}, ${c} bekleyen` : n.label}>
                <Icon name={n.icon} /><span className="l">{n.label}</span>{c ? <span className="gh-cnt" aria-hidden="true">{c}</span> : null}
              </a>
            );
          })}
        </div>
        <div className="gh-side-foot">
          <div className="gh-user"><b>{me?.displayName ?? ''}</b><span>{roles.map(r => ROLE_TR[r] ?? r).join(' · ') || 'Platform rolü yok'}</span></div>
          <div className="gh-mini">
            <button type="button" onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')} aria-label={mode === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç'} data-testid="theme-toggle" title="Tema"><Icon name={mode === 'dark' ? 'sun' : 'moon'} size={15} /> <span>{mode === 'dark' ? 'Açık' : 'Koyu'}</span></button>
            <button type="button" onClick={() => { void logout().then(() => router.replace('/login')); }} data-testid="desk-logout" title="Çıkış yap" aria-label="Çıkış yap"><Icon name="out" size={15} /> <span>Çıkış</span></button>
          </div>
        </div>
      </nav> : null}
      <main className={active ? 'gh-col' : undefined} style={active ? undefined : { display: 'contents' }} id={active ? 'gh-main' : undefined}>{children}</main>
    </div>
  );
}

/** Her çalışma alanı: sayfa başlığı + kapsam + o ekranda anlamlı arama/süzgeç; yetki yoksa kabuk içinde "erişim kısıtlı". */
export function Page({ nav, title, scope, tools, actions, children }: { nav: string; title: string; scope?: ReactNode; tools?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const { me } = useSession(); const roles = me?.platformRoles ?? []; const n = NAV.find(x => x.key === nav)!;
  useEffect(() => { if (typeof document !== 'undefined') document.title = `${title} · GoverHub yönetim`; }, [title]);
  if (!allowed(roles, n)) return <div className="gh-page"><header className="gh-head"><h1>{title}</h1></header><Locked what={title} need={n.need} /></div>;
  return (
    <div className="gh-page">
      <header className="gh-head"><h1 data-testid="page-title">{title}</h1>{scope ? <span className="gh-scope" data-testid="page-scope">{scope}</span> : null}<span className="gh-grow" />{actions}</header>
      {tools ? <div className="gh-tools">{tools}</div> : null}
      {children}
    </div>
  );
}
