import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Platform, Text, View } from 'react-native';
import { API_URL, errorText } from '../api/client';
import { useSession } from '../api/session';
import { ErrorBox, Field } from '../components/states';
import { FilterChip, GhostButton, PrimaryButton, Tap, Tile } from '../components/ui';
import { C, tint, type } from '../theme';
import { fmtDateTime } from './dates';

export type Post = { id: string; authorId: string; authorName: string; authorTitle: string; authorPhoto: boolean; kind: 'post' | 'case'; status: 'draft' | 'published';
  body: string | null; caseSnapshot: any; createdAt: string; publishedAt: string | null; editedAt: string | null; hidden: boolean; hiddenReason: string | null;
  commentCount: number; mine: boolean; label: string; reapprovalNeeded?: boolean; withdrawn?: { reason: string; at: string } | null };

export const USER_CONTENT = 'Kullanıcı paylaşımı · doğrulanmış mevzuat ya da platform onaylı içerik değildir.';
export const REPORT_REASONS: [string, string][] = [['misleading', 'Yanıltıcı / mevzuat gibi sunulmuş'], ['personal_data', 'Kişisel veri'], ['commercial_data', 'Ticari bilgi'],
  ['harassment', 'Taciz / hakaret'], ['spam', 'Spam / reklam'], ['other', 'Diğer']];

/** Profile photo: needs the session (network users only), so it is fetched with the token. */
export function Avatar({ userId, has, name, size = 40 }: { userId: string; has: boolean; name: string; size?: number }) {
  const { token } = useSession();
  const [uri, setUri] = useState<string | null>(null);
  const url = `${API_URL}/network/profiles/${userId}/photo`;
  useEffect(() => {
    if (!has || Platform.OS !== 'web') return;
    let off = false;
    fetch(url, { headers: { authorization: `Bearer ${token}` } }).then(r => (r.ok ? r.blob() : null)).then(b => { if (b && !off) setUri(URL.createObjectURL(b)); }).catch(() => {});
    return () => { off = true; };
  }, [has, url, token]);
  if (has && Platform.OS !== 'web') return <Image source={{ uri: url, headers: { authorization: `Bearer ${token}` } }} style={{ width: size, height: size, borderRadius: size / 3 }} />;
  if (has && uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 3 }} />;
  const initials = name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return <Tile size={size} fontSize={size * 0.38} initials>{initials}</Tile>;
}

export function CaseBox({ s }: { s: any }) {
  if (!s) return null;
  const row = (k: string, v: string) => <Text key={k} style={type(12, 500, { color: C.t2, lh: 1.45 })}><Text style={type(12, 700, { color: C.t1 })}>{k}: </Text>{v}</Text>;
  return (
    <View style={{ borderWidth: 1, borderColor: tint.info(0.3), backgroundColor: tint.info(0.05), borderRadius: 14, padding: 11, gap: 3 }}>
      <Text style={type(10, 700, { ls: 0.08, color: C.info })}>VAKA PAYLAŞIMI · ANONİM</Text>
      {s.hazard ? row('Konu', s.hazard) : null}
      {s.risk ? row('Risk', s.risk) : null}
      {s.causes ? row('Neden', [...s.causes.initial, ...(s.causes.verified.length ? [`doğrulanmış: ${s.causes.verified.join(', ')}`] : [])].join(', ') || '—') : null}
      {s.actions ? row('Aksiyonlar', s.actions.join(' · ') || '—') : null}
      {s.outcome ? row('Sonuç', s.outcome) : null}
    </View>
  );
}

export function PostCard({ p, onPress }: { p: Post; onPress?: () => void }) {
  return (
    <Tap testID={`net-post-${p.id}`} onPress={onPress ?? (() => router.push(`/network/post/${p.id}`))} style={{ borderWidth: 1, borderColor: p.status === 'draft' ? tint.warn(0.35) : C.bd, borderRadius: 22, backgroundColor: C.card, padding: 15, gap: 9 }}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <Avatar userId={p.authorId} has={p.authorPhoto} name={p.authorName} size={36} />
        <View style={{ flex: 1 }}>
          <Text style={type(13.5, 600)}>{p.authorName}</Text>
          <Text style={type(11, 400, { color: C.t3 })}>{p.authorTitle ? `${p.authorTitle} · ` : ''}{fmtDateTime(p.publishedAt ?? p.createdAt)}{p.editedAt ? ' · düzenlendi' : ''}</Text>
        </View>
        {p.status === 'draft' ? <Text style={type(10, 700, { ls: 0.08, color: C.warn })}>TASLAK · YALNIZ SEN</Text> : null}
      </View>
      {p.hidden ? <Text style={type(12, 600, { color: C.crit, lh: 1.45 })}>Moderasyonla gizlendi: {p.hiddenReason}</Text> : null}
      {p.kind === 'case' ? <CaseBox s={p.caseSnapshot} /> : null}
      {p.body ? <Text style={type(13.5, 400, { lh: 1.55 })}>{p.body}</Text> : null}
      <Text style={type(10.5, 500, { color: C.t3, lh: 1.4 })}>{USER_CONTENT}{p.status === 'published' ? ` · ${p.commentCount} yorum` : ''}</Text>
    </Tap>
  );
}

/** Report a post, comment or profile; a moderator decides with a reason. */
export function ReportBox({ targetType, targetId, onDone }: { targetType: 'post' | 'comment' | 'profile'; targetId: string; onDone: () => void }) {
  const { call } = useSession();
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  if (done) return <Text style={type(12, 500, { color: C.lime })}>Şikâyet moderasyona iletildi.</Text>;
  return (
    <View style={{ gap: 8, borderWidth: 1, borderColor: tint.crit(0.25), borderRadius: 16, padding: 12 }}>
      <Text style={type(12, 600, { color: C.t2 })}>Neden şikâyet ediyorsun?</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {REPORT_REASONS.map(([k, l]) => <FilterChip key={k} testID={`net-report-${k}`} label={l} px={11} active={reason === k} onPress={() => setReason(k)} />)}
      </View>
      <Field label="Açıklama (isteğe bağlı)" testID="net-report-details" value={details} onChangeText={setDetails} multiline />
      {error ? <ErrorBox message={error} /> : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <PrimaryButton testID="net-report-send" label="Gönder" glow={false} height={38} size={12} style={{ flex: 1 }} disabled={!reason}
          onPress={async () => { setError(null); try { await call('POST', '/network/reports', { targetType, targetId, reason, details }); setDone(true); } catch (e) { setError(errorText(e)); } }} />
        <GhostButton label="Vazgeç" height={38} size={12} onPress={onDone} />
      </View>
    </View>
  );
}
