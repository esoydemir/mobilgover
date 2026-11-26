import { useState } from 'react';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { Badge, Btn, Callout, Failed, Field, Kv, ListDetail, Loading, PanelHead, Search, Section, Zero, useDesk, useWsState, type Col } from './kit';
import { ROLE_TR, Page } from './Shell';

type PUser = { id: string; displayName: string; email: string | null; roles: string[] };
const ROLES = ['platform_admin', 'rule_author', 'rule_reviewer', 'marketplace_reviewer', 'network_moderator'] as const;
const ROLE_NOTE: Record<string, string> = {
  platform_admin: 'Roller verir, mevzuat dosyalarını atar, denetim geçmişini okur. Atama, karar yetkisi vermez.',
  rule_author: 'Kural taslağı yazar ve incelemeye gönderir.',
  rule_reviewer: 'Kural sürümlerini inceler; karar için ayrıca alan yetkisi gerekir.',
  marketplace_reviewer: 'Uzman belgesi, kategori başvurusu ve hizmet şikâyetlerini karara bağlar.',
  network_moderator: 'Şikâyet edilen paylaşım, yorum ve profillere karar verir; itirazları inceler.',
};

export function Users() {
  const { me } = useSession(); const ok = (me?.platformRoles ?? []).includes('platform_admin');
  const [st, set] = useWsState('kul', { q: '' });
  const users = useApi<PUser[]>(ok ? `/admin/platform-users${st.q.trim() ? `?q=${encodeURIComponent(st.q.trim())}` : ''}` : null);
  const rows = users.data ?? [];
  const cols: Col<PUser>[] = [
    { key: 'n', label: 'Kullanıcı', w: 'minmax(0,1fr)', render: u => <><div className="t">{u.displayName}</div>{u.email ? <div className="s">{u.email}</div> : null}</> },
    { key: 'r', label: 'Platform rolleri', w: 'minmax(0,1.2fr)', render: u => u.roles.length ? <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>{u.roles.map(r => <Badge key={r} tone="info">{ROLE_TR[r] ?? r}</Badge>)}</span> : <span style={{ color: 'var(--ink3)' }}>Rolü yok</span> },
  ];
  return (
    <Page nav="kullanicilar" title="Kullanıcılar ve Yetkiler" scope={<span data-testid="kul-scope">{users.data ? `${rows.length} kullanıcı${st.q.trim() ? ' (aramaya uyan)' : ''}` : 'Roller gerekçeyle verilir ve alınır'}</span>}
      tools={<Search label="Kullanıcı ara" placeholder="Ad ya da e-posta ara" value={st.q} onChange={v => set({ q: v })} testid="kul-search" />}>
      {users.error && !users.data ? <Failed what="Kullanıcı listesi" message={users.error} onRetry={() => { void users.reload(); }} /> : null}
      <ListDetail ws="kul" label="Kullanıcılar" rows={rows} rowId={u => u.id} cols={cols} selId={st.sel ?? ''} onSelect={id => set({ sel: id })} ready={!!users.data}
        empty={!users.data && !users.error ? <Loading what="Kullanıcılar" /> : users.error ? null : <Zero title="Kullanıcı bulunamadı" text={st.q.trim() ? 'Arama sözcüğünü değiştir.' : undefined} />}
        panelTitle="Kullanıcı yetkileri"
        panel={st.sel ? (rows.find(u => u.id === st.sel) ? <UserPanel key={st.sel} u={rows.find(u => u.id === st.sel)!} self={me?.userId === st.sel} reload={async () => { await users.reload(); }} /> : <div className="gh-empty-panel"><b>Bu kullanıcı bu listede yok.</b><p>Aramayı temizle.</p></div>) : null} />
    </Page>
  );
}

function UserPanel({ u, self, reload }: { u: PUser; self: boolean; reload: () => Promise<void> }) {
  const { call } = useSession(); const { toast } = useDesk(); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const short = reason.trim().length < 10 ? `Gerekçe en az 10 karakter olmalı (şu an ${reason.trim().length}).` : null;
  const change = async (role: string, grant: boolean) => {
    setBusy(true); setError(null);
    try { await call('POST', '/admin/platform-roles', { userId: u.id, role, grant, reason: reason.trim() }); toast(`${u.displayName}: ${ROLE_TR[role]} ${grant ? 'verildi' : 'kaldırıldı'}`); setReason(''); await reload(); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <PanelHead title={u.displayName} eyebrow={self ? <Badge tone="ok">Bu sensin</Badge> : undefined} />
      <div className="gh-panel-scroll" data-testid="kul-detail">
        <Section no={1} title="Kullanıcı"><Kv rows={[['E-posta', u.email ?? 'kayıtlı değil'], ['Roller', u.roles.length ? u.roles.map(r => ROLE_TR[r] ?? r).join(', ') : 'Platform rolü yok']]} /></Section>
        <Section no={2} title="Roller">
          {self ? <Callout tone="info">Kendi rollerini değiştiremezsin; başka bir platform yöneticisi yapmalı.</Callout> : null}
          <ul className="gh-hist" style={{ listStyle: 'none' }}>
            {ROLES.map(r => { const on = u.roles.includes(r); return (
              <li key={r} style={{ gridTemplateColumns: 'minmax(0,1fr) auto', alignItems: 'center' }}>
                <span><b>{ROLE_TR[r]}</b> {on ? <Badge tone="ok">Var</Badge> : null}<div className="gh-note">{ROLE_NOTE[r]}</div></span>
                <Btn size="sm" kind={on ? 'dng' : undefined} testid={`prole-${u.id}-${r}`} disabled={busy || self || !!short} onClick={() => { void change(r, !on); }}>{on ? 'Kaldır' : 'Ver'}</Btn>
              </li>); })}
          </ul>
        </Section>
        <Section no={3} title="Gerekçe">
          <Field label="Her değişiklik için zorunlu (en az 10 karakter)" value={reason} onChange={setReason} multiline testid="prole-reason" placeholder="ör. Moderasyon vardiyası için görevlendirildi" />
          {short && !self ? <div className="gh-why" data-testid="prole-why">Rol düğmeleri pasif: {short}</div> : null}
          <div className="gh-note">Son platform yöneticisi kaldırılamaz. Her değişiklik, gerekçesiyle denetim geçmişine yazılır.</div>
          {error ? <Callout tone="crit" testid="prole-error"><b>İşlem yapılamadı: </b>{error}</Callout> : null}
        </Section>
      </div>
    </>
  );
}
