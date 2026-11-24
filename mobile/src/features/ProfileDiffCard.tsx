import { Text, View } from 'react-native';
import { Card, Eyebrow } from '../components/ui';
import { C, type } from '../theme';
import type { ProfileDiff } from './ProfileQuestions';

const WORD: Record<string, string> = { applies: 'uygulanır', not_applicable: 'uygulanmaz', needs_info: 'bilgi eksik' };

/** After a profile save: WHICH checks started, stopped or still wait for an answer, and how many tasks that created or cancelled. */
export function ProfileDiffCard({ diff }: { diff: ProfileDiff }) {
  const started = diff.changes.filter(c => c.to === 'applies' && c.from !== 'applies');
  const stopped = diff.changes.filter(c => c.from === 'applies' && c.to !== 'applies');
  const waiting = diff.changes.filter(c => c.to === 'needs_info' && c.from !== 'applies');
  const other = diff.changes.filter(c => !started.includes(c) && !stopped.includes(c) && !waiting.includes(c));
  const line = (c: ProfileDiff['changes'][number]) => `• ${c.title}${c.from ? ` (${WORD[c.from] ?? c.from} → ${WORD[c.to] ?? c.to})` : ''}`;
  return (
    <Card testID="profile-diff" radius={18} style={{ padding: 14, gap: 6 }}>
      <Eyebrow>KAYITTAN SONRA NE DEĞİŞTİ</Eyebrow>
      {diff.changes.length === 0 ? <Text testID="profile-diff-none" style={type(13, 500, { color: C.t2, lh: 1.45 })}>Hiçbir yükümlülüğün durumu değişmedi; görev eklenmedi, iptal edilmedi.</Text> : null}
      {started.length ? <View testID="profile-diff-started" style={{ gap: 2 }}><Text style={type(12, 700, { color: C.lime })}>Artık uygulanıyor ({started.length})</Text>{started.map(c => <Text key={c.ruleCode} style={type(13, 500, { lh: 1.4 })}>{line(c)}</Text>)}</View> : null}
      {stopped.length ? <View testID="profile-diff-stopped" style={{ gap: 2 }}><Text style={type(12, 700, { color: C.warn })}>Artık uygulanmıyor ({stopped.length})</Text>{stopped.map(c => <Text key={c.ruleCode} style={type(13, 500, { lh: 1.4 })}>{line(c)}</Text>)}</View> : null}
      {waiting.length ? <View testID="profile-diff-waiting" style={{ gap: 2 }}><Text style={type(12, 700, { color: C.warn })}>Hâlâ cevap bekliyor ({waiting.length})</Text>{waiting.map(c => <Text key={c.ruleCode} style={type(13, 500, { lh: 1.4 })}>{line(c)}</Text>)}</View> : null}
      {other.length ? <View style={{ gap: 2 }}><Text style={type(12, 700, { color: C.t2 })}>Diğer değişiklikler ({other.length})</Text>{other.map(c => <Text key={c.ruleCode} style={type(12.5, 400, { color: C.t2, lh: 1.4 })}>{line(c)}</Text>)}</View> : null}
      <Text testID="profile-diff-tasks" style={type(12.5, 600, { color: C.t1 })}>Görevler: {diff.created} yeni oluştu · {diff.cancelled} açık görev iptal edildi. Geçmiş kayıtlar değişmez.</Text>
    </Card>
  );
}
