import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { ErrorBox, Field, Loading, SectionLabel } from '../components/states';
import { Card, FilterChip, GhostButton, PrimaryButton } from '../components/ui';
import { C, tint, type } from '../theme';
import { fmtDateTime } from './dates';

type Overview = { companies: { real: number; demo: number }; users: number; ruleVersions: Record<string, number>; marketplaceQueue: { verifications: number; authorizations: number };
  openNetworkReports: number; roleHolders: { role: string; label: string; count: number }[]; yourRoles: string[]; exampleRulesNote: string };
type AuditItem = { id: number; companyName: string | null; scope: string; occurredAt: string; actorName: string; eventType: string; entityType: string; reason: string | null; payload?: { code?: string; version?: number } };
type PUser = { id: string; displayName: string; email: string | null; roles: string[] };

const RULE_TR: Record<string, string> = { draft: 'taslak', in_review: 'incelemede', approved: 'onaylı', published: 'yayında', retired: 'emekli', rejected: 'reddedildi', withdrawn: 'geri çekildi' };
export const PLATFORM_ROLE_TR: Record<string, string> = { rule_author: 'Kural yazarı', rule_reviewer: 'Kural inceleyici', platform_admin: 'Platform yöneticisi', marketplace_reviewer: 'Pazar yeri inceleyicisi', network_moderator: 'Ağ moderatörü' };
const EVENT_TR: Record<string, string> = { 'platform.role_granted': 'Platform rolü verildi', 'platform.role_revoked': 'Platform rolü kaldırıldı', 'rule.approved': 'Kural onaylandı', 'rule.published': 'Kural yayınlandı',
  'rule.area_reviewed': 'Alan incelemesi', 'rule.submitted': 'Kural incelemeye gönderildi', 'rule.drafted': 'Kural taslağı yazıldı', 'pro.verification_decided': 'Uzman belgesi karara bağlandı' };

export function PlatformOverview() {
  const q = useApi<Overview>('/admin/overview');
  const o = q.data;
  if (q.error) return <ErrorBox message={q.error} onRetry={q.reload} />;
  if (!o) return <Loading />;
  const line = (l: string, v: string | number) => <Text key={l} style={type(12.5, 400, { lh: 1.6 })}><Text style={type(12.5, 600)}>{v}</Text> {l}</Text>;
  return (
    <>
      <SectionLabel>GENEL DURUM</SectionLabel>
      <Card style={{ gap: 3 }}>
        <View testID="admin-overview">
          {line('gerçek işletme', o.companies.real)}{line('demo işletmesi', o.companies.demo)}{line('kullanıcı', o.users)}
          {line('pazar yeri belgesi onay bekliyor', o.marketplaceQueue.verifications)}{line('kategori başvurusu bekliyor', o.marketplaceQueue.authorizations)}{line('açık ağ şikâyeti', o.openNetworkReports)}
          <Text style={type(12, 400, { color: C.t2, lh: 1.5 })}>Kural sürümleri: {Object.entries(o.ruleVersions).map(([k, n]) => `${RULE_TR[k] ?? k} ${n}`).join(' · ') || 'yok'}</Text>
          <Text style={type(12, 400, { color: C.t2, lh: 1.5 })}>Roller: {o.roleHolders.map(h => `${h.label} ${h.count}`).join(' · ')}</Text>
          <Text style={type(11, 400, { color: C.t3, lh: 1.45 })}>{o.exampleRulesNote}</Text>
        </View>
      </Card>
    </>
  );
}

/** Who did what, when and why. A missing reason is shown as missing. */
export function AuditTrail() {
  const [scope, setScope] = useState<'platform' | 'all'>('platform');
  const [prefix, setPrefix] = useState('');
  const q = useApi<{ items: AuditItem[]; next: number | null }>(`/admin/audit?scope=${scope}&limit=30${prefix ? `&eventType=${encodeURIComponent(prefix)}` : ''}`);
  return (
    <>
      <SectionLabel>DENETİM KAYDI · KİM, NE ZAMAN, NEDEN</SectionLabel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
        <FilterChip testID="audit-scope-platform" label="Platform" px={12} active={scope === 'platform'} onPress={() => setScope('platform')} />
        <FilterChip testID="audit-scope-all" label="Tüm işletmeler" px={12} active={scope === 'all'} onPress={() => setScope('all')} />
        {([['', 'Hepsi'], ['platform.', 'Rol değişiklikleri'], ['rule.', 'Kurallar'], ['pro.', 'Pazar yeri']] as const).map(([k, l]) => <FilterChip key={k} label={l} px={12} active={prefix === k} onPress={() => setPrefix(k)} />)}
      </View>
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {!q.data && !q.error ? <Loading /> : null}
      {q.data?.items.length === 0 ? <Text style={type(12, 400, { color: C.t2 })}>Kayıt yok.</Text> : null}
      {(q.data?.items ?? []).map(e => (
        <View key={e.id} testID={`audit-${e.id}`} style={{ borderWidth: 1, borderColor: C.bd, borderRadius: 14, padding: 11, gap: 2 }}>
          <Text style={type(12.5, 600)}>{EVENT_TR[e.eventType] ?? e.eventType}{e.payload?.code ? ` · ${e.payload.code}${e.payload.version ? ` v${e.payload.version}` : ''}` : ''}</Text>
          <Text style={type(11.5, 400, { color: C.t2, lh: 1.45 })}>{e.actorName} · {fmtDateTime(e.occurredAt)}{e.companyName ? ` · ${e.companyName}` : ' · platform'}</Text>
          <Text style={type(11.5, 400, { color: e.reason ? C.t1 : C.t3, lh: 1.45 })}>{e.reason ? `Gerekçe: ${e.reason}` : 'Gerekçe kaydedilmemiş'}</Text>
        </View>
      ))}
    </>
  );
}

/** Platform roles: grant or withdraw with a written reason. Server refuses self-change and the last administrator. */
export function PlatformRoles() {
  const { call } = useSession();
  const [find, setFind] = useState(''); const [reason, setReason] = useState(''); const [error, setError] = useState<string | null>(null); const [done, setDone] = useState<string | null>(null);
  const users = useApi<PUser[]>(`/admin/platform-users${find.trim() ? `?q=${encodeURIComponent(find.trim())}` : ''}`);
  const change = async (u: PUser, role: string, grant: boolean) => {
    setError(null); setDone(null);
    try { await call('POST', '/admin/platform-roles', { userId: u.id, role, grant, reason }); setDone(`${u.displayName}: ${PLATFORM_ROLE_TR[role]} ${grant ? 'verildi' : 'kaldırıldı'}.`); setReason(''); await users.reload(); }
    catch (e) { setError(errorText(e)); }
  };
  return (
    <>
      <SectionLabel>PLATFORM ROLLERİ</SectionLabel>
      <Field label="Kullanıcı ara (ad ya da e-posta)" testID="prole-find" value={find} onChangeText={setFind} />
      <Field label="Gerekçe (her değişiklik için zorunlu, en az 10 karakter)" testID="prole-reason" value={reason} onChangeText={setReason} placeholder="ör. Moderasyon vardiyası için görevlendirildi" />
      {error ? <ErrorBox message={error} /> : null}
      {done ? <Text testID="prole-done" style={type(12, 600, { color: C.lime })}>{done}</Text> : null}
      {users.error ? <ErrorBox message={users.error} onRetry={users.reload} /> : null}
      {(users.data ?? []).map(u => (
        <Card key={u.id} style={{ gap: 6 }}>
          <Text style={type(13, 600)}>{u.displayName}{u.email ? ` · ${u.email}` : ''}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {Object.keys(PLATFORM_ROLE_TR).map(r => {
              const on = u.roles.includes(r);
              return <FilterChip key={r} testID={`prole-${u.id}-${r}`} label={`${on ? '✓ ' : ''}${PLATFORM_ROLE_TR[r]}`} px={11} active={on} onPress={() => { if (reason.trim().length >= 10) change(u, r, !on); else setError('Önce en az 10 karakterlik gerekçeyi yaz.'); }} />;
            })}
          </View>
        </Card>
      ))}
      <Text style={type(11, 400, { color: C.t3, lh: 1.45 })}>Kendi rollerini değiştiremezsin; son platform yöneticisi kaldırılamaz. Her değişiklik denetim kaydına gerekçesiyle yazılır.</Text>
    </>
  );
}
