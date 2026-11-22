import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../../api/client';
import { useSession } from '../../api/session';
import { useApi } from '../../api/useApi';
import { Screen } from '../../components/Screen';
import { ErrorBox, Field, Loading } from '../../components/states';
import { Card, Eyebrow, FilterChip, GhostButton, PrimaryButton, shortWhy } from '../../components/ui';
import { LINK_KIND, LINK_OPTIONS } from '../../features/training';
import { useUi } from '../../state/app';
import { C, type } from '../../theme';

type Q = { q: string; options: string[]; answer: number };
type Link = { kind: 'task_template' | 'rule' | 'hazard'; ref: string };

/** New course (draft version 1) or editing an open draft. Publishing happens elsewhere, by someone with that right. */
export default function TrainingEditRoute() {
  const { courseId, versionId } = useLocalSearchParams<{ courseId?: string; versionId?: string }>();
  const { company, call } = useSession();
  const { showToast } = useUi();
  const existing = useApi<any>(company && courseId ? `/companies/${company.id}/training/courses/${courseId}` : null);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [minutes, setMinutes] = useState('5');
  const [passScore, setPassScore] = useState('80');
  const [quiz, setQuiz] = useState<Q[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const v = existing.data?.versions.find((x: any) => x.id === versionId);
    if (!v) return;
    setTitle(v.title); setSummary(v.summary); setBody(v.body); setVideoUrl(v.video_url ?? ''); setMinutes(String(v.minutes ?? '')); setPassScore(String(v.pass_score));
    setQuiz(v.quiz.map((q: any) => ({ q: q.q, options: [...q.options], answer: q.answer ?? 0 }))); setLinks(existing.data.links);
  }, [existing.data, versionId]);
  if (courseId && !existing.data) return <Screen title="Eğitim taslağı" titleEn="Draft">{existing.error ? <ErrorBox message={existing.error} /> : <Loading />}</Screen>;
  const setQ = (i: number, f: (q: Q) => Q) => setQuiz(qs => qs.map((q, j) => (j === i ? f(q) : q)));
  const toggleLink = (l: Link) => setLinks(ls => ls.some(x => x.kind === l.kind && x.ref === l.ref) ? ls.filter(x => !(x.kind === l.kind && x.ref === l.ref)) : [...ls, l]);
  const save = async () => {
    setBusy(true); setError(null);
    const payload = { title, summary, body, videoUrl: videoUrl.trim() || null, minutes: minutes ? Number(minutes) : null, passScore: Number(passScore) || 80,
      quiz: quiz.map(q => ({ ...q, options: q.options.filter(o => o.trim()) })), links };
    try {
      if (versionId) { await call('POST', `/companies/${company!.id}/training/versions/${versionId}`, payload); showToast('Taslak kaydedildi'); router.replace(`/training/${courseId}`); }
      else { const r = await call<{ id: string }>('POST', `/companies/${company!.id}/training/courses`, payload); showToast('Taslak oluşturuldu', 'Yayımlanması için incelemeye gönder.'); router.replace(`/training/${r.id}`); }
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <Screen title={versionId ? 'Taslağı düzenle' : 'Yeni eğitim içeriği'} titleEn="Training draft">
      <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Taslak olarak kaydedilir. İncelemeye gönderildikten sonra yayımlama yetkisi olan kişi yayımlar. Mevzuat metni ya da onaylı uzman görüşü gibi sunma.</Text>
      <Field label="Başlık" testID="tr-title" value={title} onChangeText={setTitle} />
      <Field label="Kısa özet" testID="tr-summary" value={summary} onChangeText={setSummary} />
      <Field label="İçerik (okunacak metin)" testID="tr-bodytext" value={body} onChangeText={setBody} multiline />
      <Field label="Video bağlantısı (isteğe bağlı)" value={videoUrl} onChangeText={setVideoUrl} autoCapitalize="none" />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><Field label="Süre (dk)" value={minutes} onChangeText={setMinutes} keyboardType="number-pad" /></View>
        <View style={{ flex: 1 }}><Field label="Geçme puanı (%)" testID="tr-pass" value={passScore} onChangeText={setPassScore} keyboardType="number-pad" /></View>
      </View>
      <Card style={{ gap: 9 }}>
        <Eyebrow>İLİŞKİLENDİR</Eyebrow>
        {(['hazard', 'task_template', 'rule'] as const).map(k => (
          <View key={k} style={{ gap: 6 }}>
            <Text style={type(12, 600, { color: C.t2 })}>{LINK_KIND[k]}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
              {LINK_OPTIONS.filter(o => o.kind === k).map(o => <FilterChip key={o.ref} testID={`tr-link-${o.ref}`} label={o.label} px={11} active={links.some(l => l.kind === o.kind && l.ref === o.ref)} onPress={() => toggleLink({ kind: o.kind, ref: o.ref })} />)}
            </View>
          </View>
        ))}
      </Card>
      <Card style={{ gap: 10 }}>
        <Eyebrow>KISA DEĞERLENDİRME</Eyebrow>
        {quiz.map((q, i) => (
          <View key={i} style={{ gap: 7, borderTopWidth: i ? 1 : 0, borderTopColor: C.bd, paddingTop: i ? 10 : 0 }}>
            <Field label={`Soru ${i + 1}`} testID={`tr-q-${i}`} value={q.q} onChangeText={x => setQ(i, o => ({ ...o, q: x }))} />
            {q.options.map((op, j) => (
              <View key={j} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
                <View style={{ flex: 1 }}><Field testID={`tr-q-${i}-o-${j}`} value={op} placeholder={`Seçenek ${j + 1}`} onChangeText={x => setQ(i, o => ({ ...o, options: o.options.map((y, k) => (k === j ? x : y)) }))} /></View>
                <FilterChip testID={`tr-q-${i}-a-${j}`} label={q.answer === j ? '✓ Doğru' : 'Doğru'} px={10} active={q.answer === j} onPress={() => setQ(i, o => ({ ...o, answer: j }))} />
              </View>
            ))}
            <View style={{ flexDirection: 'row', gap: 7 }}>
              {q.options.length < 5 ? <GhostButton label="Seçenek ekle" height={32} size={11} onPress={() => setQ(i, o => ({ ...o, options: [...o.options, ''] }))} /> : null}
              <GhostButton label="Soruyu sil" height={32} size={11} color={C.crit} onPress={() => setQuiz(qs => qs.filter((_, k) => k !== i))} />
            </View>
          </View>
        ))}
        {quiz.length < 10 ? <GhostButton testID="tr-add-q" label="Soru ekle" height={36} size={12} style={{ alignSelf: 'flex-start' }} onPress={() => setQuiz(qs => [...qs, { q: '', options: ['', ''], answer: 0 }])} /> : null}
      </Card>
      {error ? <ErrorBox message={error} /> : null}
      <PrimaryButton testID="tr-save" label={busy ? 'Kaydediliyor…' : 'Taslağı kaydet'} disabled={busy || title.trim().length < 3} why={shortWhy(title, 3, 'Başlık')} onPress={save} />
    </Screen>
  );
}
