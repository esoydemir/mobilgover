import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../../api/client';
import { useSession } from '../../api/session';
import { useApi } from '../../api/useApi';
import { Screen } from '../../components/Screen';
import { ErrorBox, ExampleBadge, Field, Loading } from '../../components/states';
import { Card, Eyebrow, PrimaryButton, Tap } from '../../components/ui';
import { DuePicker, PersonChips } from '../../features/ncr/parts';
import { useUi } from '../../state/app';
import { C, tint, type } from '../../theme';

type Course = { id: string; is_example: boolean; published: { title: string; summary: string; minutes: number | null; questions: number } | null };

/** Assign a published course to a person, optionally for a nonconformity (knowledge gap). */
export default function AssignTrainingRoute() {
  const params = useLocalSearchParams<{ courseId?: string; ncrId?: string }>();
  const { company, siteId, call } = useSession();
  const { showToast } = useUi();
  const ncr = useApi<any>(company && params.ncrId ? `/companies/${company.id}/nonconformities/${params.ncrId}` : null);
  const courses = useApi<Course[]>(company ? `/companies/${company.id}/training/courses` : null);
  const [course, setCourse] = useState<string | null>(params.courseId ?? null);
  const [person, setPerson] = useState<string | null>(null);
  const [due, setDue] = useState<string | null>(null);
  const [reason, setReason] = useState(params.ncrId ? 'Uygunsuzlukta bilgi eksikliği' : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const site = ncr.data?.site_id ?? siteId;
  const related = new Set((ncr.data?.relatedTraining ?? []).map((r: any) => r.id));
  const list = (courses.data ?? []).filter(c => c.published).sort((a, b) => Number(related.has(b.id)) - Number(related.has(a.id)));
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await call<{ id: string }>('POST', `/companies/${company!.id}/training/assignments`, { courseId: course, userId: person, siteId: site, dueAt: due, reason: reason.trim(), ncrId: params.ncrId ?? null });
      showToast('Eğitim atandı', 'Kişiye bildirim gitti. Tamamlanması uygunsuzluğu kapatmaz.');
      if (params.ncrId && router.canGoBack()) router.back();
      else router.replace(params.ncrId ? `/ncr/${params.ncrId}` : `/training/a/${r.id}`);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <Screen title="Eğitim ata" titleEn="Assign training">
      {params.ncrId && ncr.data ? <Text style={type(12.5, 500, { color: C.warn, lh: 1.45 })}>Uygunsuzluk: {ncr.data.title}. Eğitim bu kayda bağlanır; tamamlanması kaydı kapatmaz, sahada etkinliği ayrıca doğrulanır.</Text> : null}
      <Eyebrow>EĞİTİM</Eyebrow>
      {!courses.data ? <Loading /> : list.map(c => (
        <Tap key={c.id} testID={`tr-pick-${c.id}`} onPress={() => setCourse(c.id)} style={{ borderWidth: 1, borderColor: course === c.id ? tint.lime(0.4) : C.bd, backgroundColor: course === c.id ? tint.lime(0.06) : C.card, borderRadius: 18, padding: 13, gap: 5 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Text style={[type(13.5, 600), { flex: 1 }]}>{c.published!.title}</Text>
            {related.has(c.id) ? <Text style={type(10, 700, { ls: 0.08, color: C.lime })}>BU KONUYLA İLGİLİ</Text> : null}
            {c.is_example ? <ExampleBadge label="ÖRNEK İÇERİK" /> : null}
          </View>
          <Text style={type(11.5, 400, { color: C.t3 })}>{c.published!.summary}</Text>
        </Tap>
      ))}
      <Card style={{ gap: 9 }}>
        <Eyebrow>KİME</Eyebrow>
        {site ? <PersonChips siteId={site} value={person} onChange={setPerson} /> : null}
        <Text style={type(12, 600, { color: C.t2 })}>Termin (isteğe bağlı)</Text>
        <DuePicker value={due} onChange={setDue} />
        <Field label="Neden" testID="tr-reason" value={reason} onChangeText={setReason} multiline />
      </Card>
      {error ? <ErrorBox message={error} /> : null}
      <PrimaryButton testID="tr-assign-save" label={busy ? 'Atanıyor…' : 'Eğitimi ata'} disabled={busy || !course || !person || reason.trim().length < 5} onPress={submit} />
    </Screen>
  );
}
