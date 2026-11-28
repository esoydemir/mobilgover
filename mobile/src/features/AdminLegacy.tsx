import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { Screen } from '../components/Screen';
import { ErrorBox, ExampleBadge, Field, SectionLabel } from '../components/states';
import { Card, FilterChip, GhostButton, PrimaryButton, shortWhy } from '../components/ui';
import { credentialLabel } from './labels';
import { MarketOps } from './ServiceExtras';
import { AdminHome } from './AdminHome';
import { useDesktop } from './desktop';
import { AuditTrail, PlatformOverview, PlatformRoles } from './PlatformAdmin';
import { useUi } from '../state/app';
import { C, tint, type } from '../theme';

type RuleVersion = { id: string; code: string; version: number; status: string; kind: string; is_example: boolean; obligation_title: string; required_review_areas: string[]; pendingAreaReviews: string[]; pendingAreaAccess?: { area: string; canReview: boolean; reviewers: string[]; waiting: string | null; note: string }[]; status_reason?: string | null };
type Queue = {
  verifications: { id: string; display_name: string; kind: string; credential_type: string | null; issuer: string; document_ref: string; valid_until: string | null }[];
  authorizations: { id: string; display_name: string; category_name: string; required_credentials: string[] }[];
};

/** Platform work: rule review/approval/publishing and marketplace checks. Needs a second factor. */
export function AdminLegacy({ rulesOnly = false }: { rulesOnly?: boolean }) {
  const { me, call, env } = useSession();
  const { showToast } = useUi();
  const roles = me?.platformRoles ?? [];
  const desktop = useDesktop();
  // /admin?list=verifications|authorizations: ana sayfadaki sayaçtan gelen, yalnız o kayıtları gösteren görünüm.
  const { list } = useLocalSearchParams<{ list?: string }>();
  const only = list === 'verifications' || list === 'authorizations' ? list : null;
  const [status, setStatus] = useState<'in_review' | 'approved' | 'published' | 'draft' | 'rejected' | 'withdrawn'>('in_review');
  const rules = useApi<RuleVersion[]>(roles.some(r => r.startsWith('rule_') || r === 'platform_admin') ? `/admin/rule-versions?status=${status}` : null);
  const queue = useApi<Queue>(roles.includes('marketplace_reviewer') ? '/admin/marketplace/queue' : null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setError(null);
    try { await fn(); showToast(msg); await rules.reload(); await queue.reload(); } catch (e) { setError(errorText(e)); }
  };
  /** Approval and publishing need a written reason; the message names the action that lacks it. */
  const decide = async (what: string, fn: () => Promise<unknown>, msg: string) => {
    if (note.trim().length === 0) { setError(`${what} için gerekçe yazmalısın.`); return; }
    await act(fn, msg);
  };
  // Warn only when the server really refuses platform actions without the second factor (env.platformMfaRequired); unknown policy → warn.
  const mfaMissing = !me?.mfaSatisfied && env?.platformMfaRequired !== false;

  return (
    <Screen noHeader={rulesOnly} title={only ? 'Yönetim · pazar yeri' : 'Yönetim'} titleEn="Platform" contentStyle={desktop ? { maxWidth: 1240, width: '100%', alignSelf: 'center' } : undefined}>
      {mfaMissing ? (
        <View style={{ borderWidth: 1, borderColor: tint.warn(0.35), backgroundColor: tint.warn(0.06), borderRadius: 16, padding: 13, gap: 8 }}>
          <Text testID="admin-mfa-warning" style={type(12.5, 600, { color: C.warn, lh: 1.45 })}>Bu oturum ek doğrulamadan geçmedi. Ek doğrulama tamamlanana kadar sunucu platform listelerini ve işlemlerini (onay, ret, atama, yayın) reddeder.</Text>
          <GhostButton testID="admin-mfa-setup" label={me?.mfaEnabled ? 'Ek doğrulamayı tamamla' : 'Ek doğrulamayı kur'} height={38} size={12} onPress={() => router.push('/account')} />
        </View>
      ) : null}
      {error ? <ErrorBox message={error} /> : null}
      {only ? <GhostButton testID="admin-back-home" label="‹ Bekleyen işlere dön" height={38} size={12} onPress={() => router.replace('/admin')} /> : null}
      {!only && !rulesOnly && roles.length > 0 ? <AdminHome /> : null}
      {!only && !rulesOnly && roles.length > 0 ? <GhostButton testID="admin-legislation" label="Mevzuat masasını aç: kuyruk, kaynak, atama, karar ›" height={42} size={12.5} onPress={() => router.push('/legislation')} /> : null}
      {!only && !rulesOnly && roles.length > 0 ? <PlatformOverview /> : null}
      <Field testID="admin-reason" label="Gerekçe (onay ve yayın için zorunlu)" value={note} onChangeText={setNote} placeholder="ör. Kaynak metinle karşılaştırıldı" />

      {!only && (rules.data || rules.error) ? (
        <>
          <SectionLabel>KURAL SÜRÜMLERİ</SectionLabel>
          {roles.includes('rule_author') ? <PrimaryButton testID="rule-new" label="Yeni kural taslağı yaz" glow={false} height={42} size={12.5} onPress={() => router.push('/rule/new')} /> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
            {(['in_review', 'approved', 'published', 'draft', 'rejected', 'withdrawn'] as const).map(s => <FilterChip key={s} label={{ in_review: 'İncelemede', approved: 'Onaylı', published: 'Yayında', draft: 'Taslak', rejected: 'Reddedilen', withdrawn: 'Geri çekilen' }[s]} px={12} active={status === s} onPress={() => setStatus(s)} />)}
          </View>
          {rules.error ? <ErrorBox message={rules.error} /> : null}
          {(rules.data ?? []).map(r => (
            <Card key={r.id} style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Text style={type(12, 700, { family: 'mono' })}>{r.code} v{r.version}</Text>
                {r.is_example ? <ExampleBadge /> : null}
              </View>
              <Text style={type(14, 600)} onPress={() => router.push(`/rule/${r.id}`)}>{r.obligation_title} ›</Text>
              <Text style={type(11.5, 400, { color: C.t3 })}>Gerekli alan incelemesi: {r.required_review_areas.join(', ') || 'yok'}{r.pendingAreaReviews.length ? ` · bekleyen: ${r.pendingAreaReviews.join(', ')}` : ''}</Text>
              {r.status === 'in_review' ? (
                <View style={{ gap: 8 }}>
                  {r.pendingAreaReviews.map(a => {
                    const acc = r.pendingAreaAccess?.find(x => x.area === a);
                    return acc && !acc.canReview ? (
                      <View key={a} testID={`area-blocked-${a}`} style={{ borderWidth: 1, borderColor: tint.warn(0.35), borderRadius: 14, padding: 10, gap: 3 }}>
                        <Text style={type(12, 700, { color: C.warn })}>{a} alanı · bu hesap inceleyemez</Text>
                        <Text style={type(11.5, 400, { color: C.t2, lh: 1.45 })}>{acc.note}</Text>
                        {acc.waiting ? <Text testID={`area-waiting-${a}`} style={type(11.5, 600, { color: C.warn, lh: 1.45 })}>{acc.waiting}</Text> : null}
                      </View>
                    ) : (
                      <GhostButton key={a} testID={`area-approve-${a}`} label={`${a} alanında onayla (alan uzmanı)`} height={38} size={12} disabled={note.trim().length < 5} why={shortWhy(note, 5, 'Not')}
                        onPress={() => act(() => call('POST', `/admin/rule-versions/${r.id}/area-review`, { area: a, decision: 'approved', notes: note.trim() }), 'Alan incelemesi kaydedildi')} />
                    );
                  })}
                  <PrimaryButton label="Kuralı onayla" height={42} size={12.5} glow={false} disabled={r.pendingAreaReviews.length > 0}
                    onPress={() => decide('Kuralı onaylamak', () => call('POST', `/admin/rule-versions/${r.id}/approve`, { reason: note.trim() }), 'Kural onaylandı')} />
                </View>
              ) : null}
              {r.status === 'in_review' || r.status === 'approved' ? (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <GhostButton testID="rule-return" label="Taslağa iade et" height={38} size={12} style={{ flex: 1 }} disabled={note.trim().length < 10} why={shortWhy(note, 10, 'Not')}
                    onPress={() => decide('Taslağa iade', () => call('POST', `/admin/rule-versions/${r.id}/return`, { reason: note.trim() }), 'Yazara iade edildi; alan incelemeleri yeniden gerekir')} />
                  <GhostButton testID="rule-reject" label="Reddet" height={38} size={12} style={{ flex: 1 }} color={C.warn} border={tint.warn(0.4)} disabled={note.trim().length < 10} why={shortWhy(note, 10, 'Not')}
                    onPress={() => decide('Reddetmek', () => call('POST', `/admin/rule-versions/${r.id}/reject`, { reason: note.trim() }), 'Sürüm reddedildi')} />
                </View>
              ) : null}
              {r.status === 'in_review' || r.status === 'approved' ? <Text style={type(11, 400, { color: C.t3, lh: 1.4 })}>İade yazara geri verir; ret sürümü kapatır. İkisi için de gerekçe en az 10 karakter.</Text> : null}
              {r.status === 'published' ? (
                <View style={{ gap: 6 }}>
                  <GhostButton testID="rule-withdraw" label="Yayımlanmış sürümü geri çek" height={38} size={12} color={C.warn} border={tint.warn(0.4)} disabled={note.trim().length < 10} why={shortWhy(note, 10, 'Not')}
                    onPress={() => decide('Geri çekmek', async () => { const x = await call<{ futureTasksStopped: number; dueTasksFlagged: number; notified: number }>('POST', `/admin/rule-versions/${r.id}/withdraw`, { reason: note.trim() }); showToast('Sürüm geri çekildi', `${x.futureTasksStopped} ileri tarihli iş durdu · ${x.dueTasksFlagged} iş incelemeye alındı · ${x.notified} bildirim`); }, 'Geri çekildi')} />
                  <Text style={type(11, 400, { color: C.t3, lh: 1.4 })}>Geri çekince yeni iş açılmaz, ileri tarihli işler durur, vadesi gelenler incelemeye düşer, geçmiş kayıtlar korunur.</Text>
                </View>
              ) : null}
              {r.status === 'rejected' || r.status === 'withdrawn' ? <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>{r.status === 'rejected' ? 'Reddedildi' : 'Geri çekildi'}{r.status_reason ? `: ${r.status_reason}` : ''}</Text> : null}
              {r.status === 'approved' ? (
                <PrimaryButton label="Yayınla" height={42} size={12.5} glow={false} onPress={() => decide('Kuralı yayımlamak', () => call('POST', `/admin/rule-versions/${r.id}/publish`, { reason: note.trim() }), 'Yayınlandı; işletmeler yeniden değerlendirildi')} />
              ) : null}
            </Card>
          ))}
        </>
      ) : null}

      {!rulesOnly && (queue.data || queue.error) ? (
        <>
          {only ? null : <><SectionLabel>PAZAR YERİ · ÇALIŞMA LİSTELERİ</SectionLabel><MarketOps /></>}
          {only === 'authorizations' ? null : <SectionLabel>PAZAR YERİ · BEKLEYEN BELGELER</SectionLabel>}
          {queue.error ? <ErrorBox message={queue.error} /> : null}
          {only === 'authorizations' ? null : queue.data?.verifications.length === 0 ? <Text style={type(12, 400, { color: C.t2 })}>Bekleyen belge yok.</Text> : null}
          {(only === 'authorizations' ? [] : queue.data?.verifications ?? []).map(v => (
            <Card key={v.id} style={{ gap: 6 }}>
              <Text style={type(13.5, 600)}>{v.display_name} · {v.kind === 'identity' ? 'Kimlik' : v.kind === 'credential' ? credentialLabel(v.credential_type ?? '') : 'İşletme kaydı'}</Text>
              <Text style={type(12, 400, { color: C.t2 })}>{v.issuer} · {v.document_ref}{v.valid_until ? ` · ${v.valid_until}'e kadar` : ''}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <GhostButton testID="ver-approve" label="Doğrulandı" height={38} size={12} style={{ flex: 1 }} disabled={note.trim().length < 5} why={shortWhy(note, 5, 'Not')}
                  onPress={() => act(() => call('POST', `/admin/marketplace/verifications/${v.id}/decide`, { decision: 'verified', checkMethod: note.trim(), notes: '' }), 'Belge doğrulandı')} />
                <GhostButton label="Reddet" height={38} size={12} style={{ flex: 1 }} color={C.crit} border={tint.crit(0.35)} disabled={note.trim().length < 5} why={shortWhy(note, 5, 'Not')}
                  onPress={() => act(() => call('POST', `/admin/marketplace/verifications/${v.id}/decide`, { decision: 'rejected', checkMethod: note.trim(), notes: '' }), 'Belge reddedildi')} />
              </View>
            </Card>
          ))}
          {only === 'verifications' ? null : <SectionLabel>PAZAR YERİ · KATEGORİ BAŞVURULARI</SectionLabel>}
          {only === 'verifications' ? null : <Field label="Onay bitiş tarihi (YYYY-AA-GG) — dayandığı belgelerin bitişini geçemez" testID="auth-valid-until" value={validUntil} onChangeText={setValidUntil} placeholder="ör. 2027-10-31" />}
          {(only === 'verifications' ? [] : queue.data?.authorizations ?? []).map(a => (
            <Card key={a.id} style={{ gap: 6 }}>
              <Text style={type(13.5, 600)}>{a.display_name} · {a.category_name}</Text>
              <Text style={type(12, 400, { color: C.t2 })}>Gerekli: kimlik + {a.required_credentials.map(credentialLabel).join(', ')}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <GhostButton testID="auth-approve" label="Onayla" height={38} size={12} style={{ flex: 1 }} disabled={note.trim().length < 5 || !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)}
                  onPress={() => act(() => call('POST', `/admin/marketplace/authorizations/${a.id}/decide`, { decision: 'approved', reason: note.trim(), validUntil }), 'Kategori onaylandı')} />
                <GhostButton label="Reddet" height={38} size={12} style={{ flex: 1 }} color={C.crit} border={tint.crit(0.35)} disabled={note.trim().length < 5} why={shortWhy(note, 5, 'Not')}
                  onPress={() => act(() => call('POST', `/admin/marketplace/authorizations/${a.id}/decide`, { decision: 'rejected', reason: note.trim() }), 'Başvuru reddedildi')} />
              </View>
            </Card>
          ))}
        </>
      ) : null}
      {!only && !rulesOnly && roles.includes('platform_admin') ? <><PlatformRoles /><AuditTrail /></> : null}
      {roles.length === 0 ? <Text style={type(12.5, 400, { color: C.t2 })}>Platform rolün yok.</Text> : null}
    </Screen>
  );
}
