import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../../../api/client';
import { useSession } from '../../../api/session';
import { useApi } from '../../../api/useApi';
import { Screen } from '../../../components/Screen';
import { ErrorBox, Field, Loading } from '../../../components/states';
import { Card, Eyebrow, GhostButton, PrimaryButton, Tap } from '../../../components/ui';
import { fmtDateTime } from '../../../features/dates';
import { Avatar, CaseBox, ReportBox, USER_CONTENT, type Post } from '../../../features/network';
import { useUi } from '../../../state/app';
import { C, tint, type } from '../../../theme';

type Comment = { id: string; authorId: string; authorName: string; body: string; createdAt: string; editedAt: string | null; mine: boolean; hidden: boolean; hiddenReason: string | null };

export default function PostRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { call } = useSession();
  const { showToast } = useUi();
  const q = useApi<Post & { comments: Comment[] }>(`/network/posts/${id}`);
  const [comment, setComment] = useState('');
  const [edit, setEdit] = useState<string | null>(null);
  const [editC, setEditC] = useState<{ id: string; body: string } | null>(null);
  const [report, setReport] = useState<{ type: 'post' | 'comment'; id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const p = q.data;
  const run = async (fn: () => Promise<unknown>, ok?: string) => { setError(null); try { await fn(); if (ok) showToast(ok); await q.reload(); } catch (e) { setError(errorText(e)); } };
  if (!p) return <Screen title="Paylaşım" titleEn="Post">{q.error ? <ErrorBox message={q.error} /> : <Loading />}</Screen>;
  return (
    <Screen title="Paylaşım" titleEn="Post" onRefresh={q.reload} refreshing={q.loading}>
      <Tap onPress={() => router.push(`/network/p/${p.authorId}`)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <Avatar userId={p.authorId} has={p.authorPhoto} name={p.authorName} />
        <View style={{ flex: 1 }}>
          <Text style={type(14, 600)}>{p.authorName}</Text>
          <Text style={type(11.5, 400, { color: C.t3 })}>{p.authorTitle} · {fmtDateTime(p.publishedAt ?? p.createdAt)}{p.editedAt ? ' · düzenlendi' : ''}</Text>
        </View>
      </Tap>
      {p.status === 'draft' ? <Text style={type(12, 600, { color: C.warn })}>TASLAK · yalnız sen görürsün</Text> : null}
      {p.withdrawn ? <Text testID="net-withdrawn" style={type(12.5, 600, { color: C.crit, lh: 1.45 })}>İşletme bu vaka paylaşımını geri çekti; ağda görünmüyor. Gerekçe: {p.withdrawn.reason}</Text> : null}
      {p.reapprovalNeeded ? <Text testID="net-reapproval" style={type(12.5, 600, { color: C.warn, lh: 1.45 })}>Metin izin verilen sürümden farklı. Yayımlamak için işletme sahibi ya da merkez yöneticisinin yeniden onayı gerekir (Uygunsuzluk ekranı → Vaka paylaşımları).</Text> : null}
      {p.kind === 'case' && p.mine && p.status === 'published' ? <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Metni değiştirirsen paylaşım ağdan kalkar ve yeniden izin gerekir.</Text> : null}
      {p.hidden ? <Text style={type(12.5, 600, { color: C.crit, lh: 1.45 })}>Moderasyonla gizlendi. Gerekçe: {p.hiddenReason}</Text> : null}
      {p.kind === 'case' ? <CaseBox s={p.caseSnapshot} /> : null}
      {edit !== null ? (
        <>
          <Field testID="net-edit-body" value={edit} onChangeText={setEdit} multiline />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <PrimaryButton testID="net-edit-save" label="Kaydet" glow={false} height={40} size={12} style={{ flex: 1 }} onPress={() => run(async () => { await call('POST', `/network/posts/${id}`, { body: edit }); setEdit(null); }, 'Kaydedildi')} />
            <GhostButton label="Vazgeç" height={40} size={12} onPress={() => setEdit(null)} />
          </View>
        </>
      ) : <Text testID="net-post-text" style={type(14, 400, { lh: 1.6 })}>{p.body}</Text>}
      <Text style={type(11, 500, { color: C.t3, lh: 1.4 })}>{USER_CONTENT}</Text>
      <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap' }}>
        {p.mine && p.status === 'draft' && !p.reapprovalNeeded ? <PrimaryButton testID="net-publish-draft" label="Yayımla" glow={false} height={36} size={12} onPress={() => run(() => call('POST', `/network/posts/${id}`, { op: 'publish' }), 'Yayımlandı')} /> : null}
        {p.mine && !p.hidden && !p.withdrawn && edit === null ? <GhostButton testID="net-edit" label="Düzenle" height={36} size={12} onPress={() => setEdit(p.body ?? '')} /> : null}
        {p.mine ? <GhostButton testID="net-delete" label="Sil" height={36} size={12} color={C.crit} border={tint.crit(0.3)} onPress={() => run(async () => { await call('POST', `/network/posts/${id}`, { op: 'delete' }); router.back(); }, 'Silindi')} /> : null}
        {!p.mine ? <GhostButton testID="net-report-post" label="Şikâyet et" height={36} size={12} onPress={() => setReport({ type: 'post', id: p.id })} /> : null}
      </View>
      {report ? <ReportBox targetType={report.type} targetId={report.id} onDone={() => setReport(null)} /> : null}
      {error ? <ErrorBox message={error} /> : null}
      {p.status === 'published' ? (
        <Card style={{ gap: 10 }}>
          <Eyebrow>YORUMLAR ({p.comments.length})</Eyebrow>
          {p.comments.map(c => (
            <View key={c.id} testID={`net-comment-${c.id}`} style={{ gap: 3, borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 8 }}>
              <Text style={type(12.5, 600)}>{c.authorName} <Text style={type(11, 400, { color: C.t3 })}>· {fmtDateTime(c.createdAt)}{c.editedAt ? ' · düzenlendi' : ''}</Text></Text>
              {c.hidden ? <Text style={type(12, 500, { color: C.crit })}>Moderasyonla gizlendi: {c.hiddenReason}</Text> : null}
              {editC?.id === c.id ? (
                <>
                  <Field value={editC.body} onChangeText={x => setEditC({ id: c.id, body: x })} multiline />
                  <GhostButton label="Kaydet" height={32} size={11} style={{ alignSelf: 'flex-start' }} onPress={() => run(async () => { await call('POST', `/network/comments/${c.id}`, { body: editC.body }); setEditC(null); })} />
                </>
              ) : <Text style={type(13, 400, { lh: 1.5 })}>{c.body}</Text>}
              <View style={{ flexDirection: 'row', gap: 12 }}>
                {c.mine ? <Text onPress={() => setEditC({ id: c.id, body: c.body })} style={type(11.5, 500, { color: C.info })}>Düzenle</Text> : null}
                {c.mine ? <Text onPress={() => run(() => call('POST', `/network/comments/${c.id}`, { op: 'delete' }))} style={type(11.5, 500, { color: C.crit })}>Sil</Text> : null}
                {!c.mine ? <Text testID={`net-report-comment-${c.id}`} onPress={() => setReport({ type: 'comment', id: c.id })} style={type(11.5, 500, { color: C.t3 })}>Şikâyet et</Text> : null}
              </View>
            </View>
          ))}
          <Field label="Yorum yaz" testID="net-comment-body" value={comment} onChangeText={setComment} multiline />
          <PrimaryButton testID="net-comment-send" label="Yorumla" glow={false} height={40} size={12} disabled={comment.trim().length < 2}
            onPress={() => run(async () => { await call('POST', `/network/posts/${id}/comments`, { body: comment.trim() }); setComment(''); }, 'Yorum eklendi')} />
        </Card>
      ) : null}
    </Screen>
  );
}
