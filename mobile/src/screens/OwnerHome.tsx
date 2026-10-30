import { router } from 'expo-router';
import { Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { GradientFill } from '../components/Gradient';
import { WarnIcon } from '../components/Icons';
import { Bar, Card, Eyebrow, GhostButton, PrimaryButton, Tap, TaskRow, TimelineRow } from '../components/ui';
import { TASKS, TIMELINE } from '../data';
import { goRoot, useApp } from '../state/app';
import { C, tint, type } from '../theme';

const DAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const TOTAL = 5;

/** Owner "command center": today's counter, one critical card, a short list. */
export function OwnerHome({ showRisk = true }: { showRisk?: boolean }) {
  const { done, doneCount, toggleTask, openSheet } = useApp();
  return (
    <>
      <HeroCard doneCount={doneCount} />

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Tap onPress={() => router.push('/score')} style={{ flex: 1, borderWidth: 1, borderColor: C.bd, borderRadius: 26, backgroundColor: C.card, paddingVertical: 17, paddingHorizontal: 18 }}>
          <StatHead glyph="◎" color={C.lime} bg={tint.lime(0.14)} label="UYUM SKORU" />
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 12 }}>
            <Text style={type(34, 600, { family: 'outfit', ls: -0.04 })}>58</Text>
            <Text style={type(14, 400, { color: C.t3 })}>/100</Text>
          </View>
          <Bar pct={0.58} height={5} track={C.track} style={{ marginTop: 14 }} />
          <Text style={[type(11, 600, { color: C.lime }), { marginTop: 9 }]}>▲ +4 bu hafta</Text>
        </Tap>
        {showRisk && (
          <View style={{ flex: 1, borderWidth: 1, borderColor: tint.crit(0.22), borderRadius: 26, backgroundColor: C.card, paddingVertical: 17, paddingHorizontal: 18 }}>
            <StatHead glyph="₺" color={C.crit} bg={tint.crit(0.14)} label="CEZA RİSKİ" />
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3, marginTop: 12 }}>
              <Text style={type(34, 600, { family: 'outfit', ls: -0.04, color: C.crit })}>₺29</Text>
              <Text style={type(14, 400, { color: tint.crit(0.6) })}>k</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 4, marginTop: 14 }}>
              {[tint.crit(0.75), tint.crit(0.4), C.track].map((bg, i) => <View key={i} style={{ flex: 1, height: 5, borderRadius: 999, backgroundColor: bg }} />)}
            </View>
            <Text style={[type(11, 400, { color: C.t3 }), { marginTop: 9 }]}>2 açık kalem</Text>
          </View>
        )}
      </View>

      <View style={{ borderWidth: 1, borderColor: tint.crit(0.3), borderRadius: 26, overflow: 'hidden', paddingTop: 18, paddingHorizontal: 19, paddingBottom: 16, marginTop: 5 }}>
        <GradientFill angle={160} stops={[[0, '#1a0b0b'], [0.45, '#110d0d'], [1, C.card]]} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <WarnIcon />
          <Text style={type(10, 700, { ls: 0.11, color: C.crit })}>KRİTİK · 3 GÜN KALDI</Text>
        </View>
        <Text style={[type(16.5, 600, { ls: -0.015, lh: 1.3 }), { marginTop: 9 }]}>Yangın tüpü periyodik kontrolü süresi doluyor</Text>
        <Text style={[type(13, 400, { lh: 1.45, color: C.t2 }), { marginTop: 6 }]}>Bugün yapmazsan denetimde eksik sayılır. Belgeyi yenilemen veya servis çağırman gerekiyor.</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
          <PrimaryButton label="Servis bul" onPress={() => goRoot('/experts')} height={44} size={13.5} style={{ flex: 1 }} />
          <GhostButton label="Neden?" onPress={() => openSheet('why')} height={44} style={{ paddingHorizontal: 18 }} />
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
        <Text style={type(10.5, 600, { ls: 0.12, color: C.t3 })}>BUGÜNÜN GÖREVLERİ</Text>
        <Tap onPress={() => goRoot('/tasks')} hitSlop={8}>
          <Text style={type(11, 600, { ls: 0.08, color: C.t2 })}>TÜMÜ →</Text>
        </Tap>
      </View>
      {TASKS.slice(0, 3).map(t => (
        <TaskRow key={t.id} title={t.title} meta={t.meta} sev={t.sev} done={!!done[t.id]}
          onToggle={() => toggleTask(t.id)} onOpen={() => router.push(`/task/${t.id}`)} />
      ))}

      <Card style={{ marginTop: 12 }}>
        <Eyebrow>YAKLAŞAN TAKVİM</Eyebrow>
        <View style={{ marginTop: 12 }}>
          {TIMELINE.map(e => (
            <TimelineRow key={e.date} left={e.date} title={e.title} meta={e.meta} dot={C[e.tone]} />
          ))}
        </View>
      </Card>

      <Tap onPress={() => router.push('/onboarding')} style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: tint.lime(0.32), borderRadius: 22, backgroundColor: tint.lime(0.04), paddingVertical: 16, paddingHorizontal: 18, marginTop: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={type(10, 600, { ls: 0.11, color: C.lime })}>KURULUM · %62</Text>
          <Text style={type(13, 400, { color: C.t2 })}>→</Text>
        </View>
        <Text style={[type(14.5, 600, { ls: -0.01 }), { marginTop: 8 }]}>3 soruyu daha yanıtla, 6 yükümlülük netleşsin</Text>
        <Bar pct={0.62} style={{ marginTop: 12 }} />
      </Tap>
    </>
  );
}

function HeroCard({ doneCount }: { doneCount: number }) {
  const circ = 2 * Math.PI * 41;
  const p = Math.max(0, Math.min(1, doneCount / TOTAL));
  return (
    <View style={{ borderWidth: 1, borderColor: tint.lime(0.14), borderRadius: 32, padding: 22, overflow: 'hidden' }}>
      <GradientFill
        angle={165}
        stops={[[0, '#171d09'], [0.55, '#0b0d05'], [1, C.page]]}
        radial={{ cx: 0.88, cy: 0, r: 1, stops: [[0, tint.lime(0.16)], [0.42, tint.lime(0.03)], [0.7, tint.lime(0)]] }}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
        <View style={{ width: 96, height: 96 }}>
          <Svg width={96} height={96} viewBox="0 0 96 96" style={{ transform: [{ rotate: '-90deg' }] }}>
            <Circle cx={48} cy={48} r={41} fill="none" stroke={C.track} strokeWidth={7} />
            <Circle cx={48} cy={48} r={41} fill="none" stroke={C.lime} strokeWidth={7} strokeLinecap="round" strokeDasharray={`${circ * p} ${circ}`} />
          </Svg>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 1 }}>
            <Text style={type(30, 600, { family: 'outfit', ls: -0.04, lh: 1 })}>{doneCount}</Text>
            <Text style={type(13, 600, { family: 'outfit', color: C.t3 })}>/{TOTAL}</Text>
          </View>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={type(10.5, 600, { ls: 0.13, color: C.t3 })}>BUGÜN · 25.08 PAZ</Text>
          <Text style={[type(21, 600, { family: 'outfit', ls: -0.03, lh: 1.15 }), { marginTop: 9 }]}>{TOTAL - doneCount} görev kaldı</Text>
          <Text style={[type(13, 400, { lh: 1.4, color: C.t2 }), { marginTop: 5 }]}>Hiçbiri iki dakikadan uzun değil.</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 6, marginTop: 22, paddingTop: 20, borderTopWidth: 1, borderTopColor: C.bd }}>
        {DAYS.map((label, i) => {
          const isDone = i < 6; // Pzt–Cmt complete, Paz is today
          return (
            <View key={label} style={{ flex: 1, alignItems: 'center', gap: 8 }}>
              <View style={{
                width: 34, height: 34, borderRadius: 999, alignItems: 'center', justifyContent: 'center', borderWidth: 2,
                borderColor: isDone ? C.lime : tint.lime(0.55), backgroundColor: isDone ? C.lime : 'transparent',
                boxShadow: isDone ? '0 3px 14px rgba(198,255,61,0.3)' : undefined,
              }}>
                <Text style={type(13, 800, { color: C.ink })}>{isDone ? '✓' : ''}</Text>
              </View>
              <Text style={type(10, 600, { ls: 0.04 })}>{label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function StatHead({ glyph, color, bg, label }: { glyph: string; color: string; bg: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
      <View style={{ width: 22, height: 22, borderRadius: 999, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={type(11, 800, { color })}>{glyph}</Text>
      </View>
      <Text style={type(10, 600, { ls: 0.11, color: C.t3 })}>{label}</Text>
    </View>
  );
}
