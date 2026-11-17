import { router, useLocalSearchParams } from 'expo-router';
import { Linking, Text, View } from 'react-native';
import { useSession } from '../../api/session';
import { useApi } from '../../api/useApi';
import { Screen } from '../../components/Screen';
import { ErrorBox, ExampleBadge, Loading, SectionLabel } from '../../components/states';
import { Card, GhostButton } from '../../components/ui';
import { fmtDateTime } from '../../features/dates';
import { dayTr } from '../../features/legislation';
import { C, tint, type } from '../../theme';

type View_ = {
  id: string; isExample: boolean;
  what: { typeLabel: string; docRef: string; docTitle: string; article: string | null; effectiveFrom: string; oldText: string | null; newText: string | null; summary: string };
  sites: { siteId: string; site: string; effect: string; decision: string; why: string | null; matchedFacts: { key: string; label: string; value: unknown }[]; tasks: { id: string; title: string; dueAt: string }[]; nextDue: string | null; tasksCreated: number }[];
  todo: { summary: string; effectiveFrom: string };
  rule: { code: string; version: number; previousVersion: number | null; title: string; summary: string; label: string };
  source: { url: string; ref: string; publishedOn: string | null };
  appliedAt: string | null;
};
const val = (v: unknown) => (v === true ? 'Evet' : v === false ? 'Hayır' : v == null ? '—' : String(v));

/** The single screen behind a legislation notification: what changed, why it applies to my site, what to do and by when, the source and the rule version. */
export default function ChangeRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { company } = useSession();
  const q = useApi<View_>(company ? `/companies/${company.id}/legislation-changes/${id}` : null);
  const d = q.data;
  if (!d) return <Screen title="Mevzuat değişikliği" titleEn="Legislation change">{q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : <Loading />}</Screen>;
  return (
    <Screen title="Mevzuat değişikliği" titleEn="Legislation change" onRefresh={q.reload} refreshing={q.loading}>
      {d.isExample ? <ExampleBadge label="ÖRNEK — GERÇEK MEVZUAT DEĞİLDİR" /> : null}

      <SectionLabel>NE DEĞİŞTİ</SectionLabel>
      <Card testID="change-what" style={{ gap: 6 }}>
        <Text style={type(15, 700, { lh: 1.35 })}>{d.what.docTitle}{d.what.article ? ` · md. ${d.what.article}` : ''}</Text>
        <Text style={type(12.5, 500, { color: C.t2, lh: 1.5 })}>{d.what.summary}</Text>
        {d.what.oldText ? <Text style={type(12, 400, { color: C.t3, lh: 1.5 })}>Eski: {d.what.oldText}</Text> : null}
        {d.what.newText ? <Text style={type(12, 500, { lh: 1.5 })}>Yeni: {d.what.newText}</Text> : null}
      </Card>

      <SectionLabel>NEDEN BENİM ŞUBEMDE UYGULANIYOR</SectionLabel>
      {d.sites.map(s => (
        <Card key={s.siteId} testID={`change-site-${s.siteId}`} style={{ gap: 6 }}>
          <Text style={type(14, 700)}>{s.site}</Text>
          {s.why ? <Text testID="change-why" style={type(12.5, 500, { color: C.t2, lh: 1.5 })}>{s.why}</Text> : null}
          {s.matchedFacts.length ? (
            <View style={{ gap: 2 }}>
              <Text style={type(11, 700, { ls: 0.08, color: C.t3 })}>ŞUBE BİLGİLERİN</Text>
              {s.matchedFacts.map(f => <Text key={f.key} style={type(12, 400, { color: C.t2 })}>• {f.label}: {val(f.value)}</Text>)}
            </View>
          ) : null}
        </Card>
      ))}

      <SectionLabel>NE YAPMALISIN</SectionLabel>
      <Card testID="change-todo" style={{ gap: 8 }}>
        <Text style={type(12.5, 500, { color: C.t2, lh: 1.5 })}>{d.todo.summary}</Text>
        <Text style={type(12.5, 600)}>Yürürlük: {dayTr(d.todo.effectiveFrom)}</Text>
        {d.sites.map(s => (
          <View key={s.siteId} style={{ gap: 4 }}>
            {s.nextDue ? <Text testID="change-due" style={type(12.5, 700, { color: C.warn })}>İlk son tarih: {fmtDateTime(s.nextDue)}</Text> : null}
            {s.tasks.map(t => (
              <GhostButton key={t.id} testID={`change-task-${t.id}`} label={`${t.title} · ${fmtDateTime(t.dueAt)}`} height={40} size={12} onPress={() => router.push(`/task/${t.id}`)} />
            ))}
          </View>
        ))}
      </Card>

      <SectionLabel>KAYNAK VE KURAL SÜRÜMÜ</SectionLabel>
      <Card testID="change-source" style={{ gap: 5 }} border={tint.white(0.12)}>
        <Text style={type(12.5, 600, { color: C.info })} onPress={() => void Linking.openURL(d.source.url)}>{d.source.url}</Text>
        <Text style={type(12, 400, { color: C.t2 })}>Belge {d.source.ref}{d.source.publishedOn ? ` · yayın ${dayTr(d.source.publishedOn)}` : ''}</Text>
        <Text testID="change-rule" style={type(12.5, 600)}>Geçerli kural sürümü: {d.rule.code} v{d.rule.version}{d.rule.previousVersion ? ` (önceki: v${d.rule.previousVersion}; tamamlanmış işler eski sürüme bağlı kalır)` : ''}</Text>
        <Text style={type(11.5, 500, { color: C.warn, lh: 1.45 })}>{d.rule.label}</Text>
      </Card>
    </Screen>
  );
}
