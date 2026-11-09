import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../../api/client';
import { useSession } from '../../api/session';
import { useApi } from '../../api/useApi';
import { Screen } from '../../components/Screen';
import { ErrorBox, ExampleBadge, Field, Loading } from '../../components/states';
import { Card, Eyebrow, GhostButton, Pill, PrimaryButton, Tap } from '../../components/ui';
import { fmtDateTime } from '../../features/dates';
import { VERSION_STATUS, linkLabel, LINK_KIND } from '../../features/training';
import { useUi } from '../../state/app';
import { C, tint, type } from '../../theme';

type Version = { id: string; version: number; status: string; title: string; summary: string; body: string; video_url: string | null; minutes: number | null; pass_score: number;
  quiz: { q: string; options: string[]; answer?: number }[]; created_by_name: string | null; submitted_by_name: string | null; submitted_at: string | null;
  published_by_name: string | null; published_at: string | null; review_notes: string | null };
type Course = { id: string; isExample: boolean; exampleNote: string | null; inhouseNote: string | null; versions: Version[]; links: { kind: string; ref: string }[];
  permissions: { author: boolean; publish: boolean; publishBlockedReason: string | null; assign: boolean; newVersion: boolean } };

/** One course: its versions and their states; writing and publishing are separate steps. */
export default function CourseRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { company, call } = useSession();
  const { showToast } = useUi();
  const q = useApi<Course>(company ? `/companies/${company.id}/training/courses/${id}` : null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = q.data;
  const base = `/companies/${company?.id}/training`;
  const run = async (fn: () => Promise<unknown>, ok: string, sub?: string) => {
    setBusy(true); setError(null);
    try { await fn(); showToast(ok, sub); setNotes(''); await q.reload(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  if (!c) return <Screen title="Eğitim" titleEn="Training">{q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : <Loading />}</Screen>;
  const pub = c.versions.find(v => v.status === 'published');
  const open = c.versions.find(v => v.status === 'draft' || v.status === 'in_review');
  const shown = pub ?? c.versions[0]!;
  return (
    <Screen title="Eğitim" titleEn="Training" onRefresh={q.reload} refreshing={q.loading}>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {pub ? <Pill label={`YAYIMLANDI · SÜRÜM ${pub.version}`} fg={C.lime} bg={tint.lime(0.14)} /> : null}
        {open ? <Pill label={`SÜRÜM ${open.version} · ${VERSION_STATUS[open.status]![0]}`} fg={VERSION_STATUS[open.status]![1]} bg={VERSION_STATUS[open.status]![2]} /> : null}
        {c.isExample ? <ExampleBadge label="ÖRNEK İÇERİK" /> : null}
      </View>
      <Text style={type(23, 600, { family: 'outfit', ls: -0.03, lh: 1.15 })}>{shown.title}</Text>
      {c.exampleNote ? <Text style={type(12, 500, { color: C.warn, lh: 1.45 })}>{c.exampleNote}</Text> : null}
      {c.inhouseNote ? <Text testID="tr-inhouse" style={type(12, 500, { color: c.inhouseNote.includes('bağımsız') ? C.warn : C.t2, lh: 1.45 })}>{c.inhouseNote} · mesleki ağda ya da platform kütüphanesinde yayımlanmaz.</Text> : null}
      {shown.summary ? <Text style={type(13, 400, { color: C.t2, lh: 1.5 })}>{shown.summary}</Text> : null}
      {c.links.length ? <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>İlişkili: {c.links.map(l => `${LINK_KIND[l.kind]}: ${linkLabel(l)}`).join(' · ')}</Text> : null}
      {c.permissions.assign ? <PrimaryButton testID="tr-assign" label="Kişiye ata" onPress={() => router.push(`/training/assign?courseId=${c.id}`)} /> : null}
      {error ? <ErrorBox message={error} /> : null}
      {open && (c.permissions.author || c.permissions.publish) ? (
        <Card style={{ gap: 9 }} border={tint.warn(0.3)}>
          <Eyebrow color={C.warn}>SÜRÜM {open.version} · {VERSION_STATUS[open.status]![0]}</Eyebrow>
          <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>{open.title} · {open.quiz.length} soru · geçme puanı %{open.pass_score}</Text>
          {open.review_notes && open.status === 'draft' ? <Text style={type(12, 400, { color: C.crit })}>Geri gönderme notu: {open.review_notes}</Text> : null}
          {open.status === 'draft' && c.permissions.author ? (
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <GhostButton testID="tr-edit" label="Taslağı düzenle" height={40} size={12} onPress={() => router.push(`/training/edit?courseId=${c.id}&versionId=${open.id}`)} />
              <PrimaryButton testID="tr-submit" label={busy ? 'Gönderiliyor…' : 'İncelemeye gönder'} glow={false} height={40} size={12} disabled={busy}
                onPress={() => run(() => call('POST', `${base}/versions/${open.id}/submit`, {}), 'İncelemeye gönderildi', 'Yayımlama yetkisi olan kişi onaylar.')} />
            </View>
          ) : null}
          {open.status === 'in_review' ? (
            c.permissions.publishBlockedReason ? <Text testID="tr-publish-blocked" style={type(12, 500, { color: C.warn, lh: 1.45 })}>{c.permissions.publishBlockedReason}</Text>
            : c.permissions.publish ? (
              <>
                <Text style={type(11.5, 400, { color: C.t3 })}>Gönderen: {open.submitted_by_name ?? open.created_by_name}{open.submitted_at ? ` · ${fmtDateTime(open.submitted_at)}` : ''}</Text>
                <Text style={type(12.5, 400, { lh: 1.5 })}>{open.body}</Text>
                <Field label="Not (geri gönderirken zorunlu)" testID="tr-review-notes" value={notes} onChangeText={setNotes} multiline />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <PrimaryButton testID="tr-publish" label={busy ? 'Kaydediliyor…' : 'Yayımla'} glow={false} height={40} size={12} style={{ flex: 1 }} disabled={busy}
                    onPress={() => run(() => call('POST', `${base}/versions/${open.id}/publish`, { notes: notes.trim() || null }), 'Yayımlandı', pub ? 'Önceki sürüm arşivlendi.' : undefined)} />
                  <GhostButton testID="tr-reject" label="Geri gönder" height={40} size={12} color={C.crit} border={tint.crit(0.3)} disabled={busy || notes.trim().length < 5}
                    onPress={() => run(() => call('POST', `${base}/versions/${open.id}/reject`, { notes: notes.trim() }), 'Taslağa geri gönderildi')} />
                </View>
              </>
            ) : <Text style={type(12, 500, { color: C.warn })}>Yayımlama yetkisi olan kişinin onayı bekleniyor. İçerik yazma ve yayımlama ayrı yetkilerdir.</Text>
          ) : null}
        </Card>
      ) : null}
      {c.permissions.newVersion && pub ? <GhostButton testID="tr-new-version" label="Yeni sürüm aç" height={40} size={12} style={{ alignSelf: 'flex-start' }} disabled={busy}
        onPress={() => run(async () => { const r = await call<{ versionId: string }>('POST', `${base}/courses/${c.id}/new-version`, {}); router.push(`/training/edit?courseId=${c.id}&versionId=${r.versionId}`); }, 'Yeni taslak sürüm açıldı')} /> : null}
      {pub ? (
        <Card style={{ gap: 8 }}>
          <Eyebrow>İÇERİK · SÜRÜM {pub.version}</Eyebrow>
          <Text testID="tr-body" style={type(13, 400, { lh: 1.55 })}>{pub.body}</Text>
          {pub.video_url ? <Text style={type(12, 500, { color: C.info })}>Video: {pub.video_url}</Text> : null}
          <Text style={type(11, 400, { color: C.t3 })}>{pub.quiz.length} soruluk kısa değerlendirme · geçme puanı %{pub.pass_score}{pub.published_by_name ? ` · yayımlayan ${pub.published_by_name}` : ''}</Text>
        </Card>
      ) : null}
      {c.permissions.assign ? <PeopleCard courseId={c.id} /> : null}
      <Eyebrow>SÜRÜMLER</Eyebrow>
      {c.versions.map(v => (
        <View key={v.id} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Text style={[type(12.5, 500), { flex: 1 }]}>Sürüm {v.version} · {v.title}</Text>
          <Text style={type(10, 700, { ls: 0.08, color: VERSION_STATUS[v.status]![1] })}>{VERSION_STATUS[v.status]![0]}</Text>
        </View>
      ))}
      {c.permissions.publish && pub && !c.isExample ? <GhostButton testID="tr-archive" label="Arşivle (yeni atama yapılamaz)" height={36} size={11.5} color={C.crit} border={tint.crit(0.3)} style={{ alignSelf: 'flex-start' }}
        onPress={() => run(() => call('POST', `${base}/courses/${c.id}/archive`, {}), 'Arşivlendi')} /> : null}
    </Screen>
  );
}

type People = { summary: { assigned: number; read: number; completed: number; passed: number; fieldEffective: number; fieldNotEffective: number; retrainings: number };
  people: { id: string; user_name: string; assigned_by_name: string; assigned_at: string; version: number; read_at: string | null; completed_at: string | null; passed_at: string | null;
    field_result: string | null; field_verified_by_name: string | null; cancelled_at: string | null; previous_assignment_id: string | null }[]; note: string };

/** Who was assigned, read, completed, passed and was verified in the field — separately, per version. */
function PeopleCard({ courseId }: { courseId: string }) {
  const { company } = useSession();
  const q = useApi<People>(company ? `/companies/${company.id}/training/courses/${courseId}/people` : null);
  if (!q.data) return null;
  const s = q.data.summary;
  return (
    <Card style={{ gap: 8 }}>
      <Eyebrow>KİŞİLER</Eyebrow>
      <Text testID="tr-people-summary" style={type(12.5, 500, { color: C.t2, lh: 1.5 })}>Atanan {s.assigned} · okuyan {s.read} · tamamlayan {s.completed} · sınavı geçen {s.passed} · sahada etkili {s.fieldEffective} · etkili değil {s.fieldNotEffective}{s.retrainings ? ` · yeniden eğitim ${s.retrainings}` : ''}</Text>
      {q.data.people.map(r => (
        <Tap key={r.id} testID={`tr-person-${r.id}`} onPress={() => router.push(`/training/a/${r.id}`)} style={{ borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 6, gap: 2 }}>
          <Text style={type(13, 600)}>{r.user_name} · sürüm {r.version}{r.previous_assignment_id ? ' · yeniden eğitim' : ''}{r.cancelled_at ? ' · iptal' : ''}</Text>
          <Text style={type(11.5, 400, { color: C.t3, lh: 1.4 })}>Atayan {r.assigned_by_name} · {r.read_at ? 'okudu' : 'okumadı'} · {r.completed_at ? 'tamamladı' : 'tamamlamadı'} · {r.passed_at ? 'geçti' : 'geçmedi'} · saha: {r.field_result === 'effective' ? `etkili (${r.field_verified_by_name})` : r.field_result === 'not_effective' ? `etkili değil (${r.field_verified_by_name})` : 'bekliyor'}</Text>
        </Tap>
      ))}
      <Text style={type(11, 400, { color: C.t3, lh: 1.4 })}>{q.data.note}</Text>
    </Card>
  );
}
