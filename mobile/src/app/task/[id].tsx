import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { CameraIcon, WarnIcon } from '../../components/Icons';
import { Screen } from '../../components/Screen';
import { Card, Chevron, Eyebrow, PrimaryButton, Rise, SevPill, Tap } from '../../components/ui';
import { TASKS, TEMP_HISTORY, TEMP_LIMIT, TEMP_OPTIONS } from '../../data';
import { goBack, useApp } from '../../state/app';
import { C, tint, type } from '../../theme';

export default function TaskDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const task = TASKS.find(t => t.id === id) ?? TASKS[0];
  const { openSheet, completeTask, showToast } = useApp();
  const [temp, setTemp] = useState<number | null>(null);
  const [photo, setPhoto] = useState(false);

  const evidenceOk = !task.needsEvidence || (temp !== null && photo);
  const overLimit = temp !== null && temp > TEMP_LIMIT;

  const complete = () => {
    if (!evidenceOk) return;
    if (overLimit) {
      openSheet('ncr');
      return;
    }
    completeTask(task.id);
    goBack();
    showToast('Görev kapatıldı', 'Kanıt zincirine yazıldı · 09:41');
  };

  return (
    <Screen title="Görev" titleEn="Task detail" gap={13}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <SevPill sev={task.sev} big />
        <Text style={type(11.5, 400, { color: C.t3 })}>{task.due}</Text>
      </View>
      <Text style={type(27, 600, { family: 'outfit', ls: -0.035, lh: 1.1 })}>{task.title}</Text>
      <Text style={type(14.5, 400, { lh: 1.5, color: C.t2 })}>{task.what}</Text>

      <Tap onPress={() => openSheet('why')} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: C.bd, borderRadius: 22, backgroundColor: C.card, paddingVertical: 14, paddingHorizontal: 16 }}>
        <View style={{ width: 26, height: 26, borderRadius: 999, backgroundColor: tint.lime(0.14), alignItems: 'center', justifyContent: 'center' }}>
          <Text style={type(13, 700, { color: C.lime })}>?</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={type(13.5, 600)}>Bunu neden yapmam gerekiyor?</Text>
          <Text style={[type(11.5, 400, { color: C.t3 }), { marginTop: 2 }]}>Why does this apply to me?</Text>
        </View>
        <Chevron size={14} />
      </Tap>

      {task.needsEvidence && (
        <>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Eyebrow>KANIT · ZORUNLU</Eyebrow>
              <Text style={type(10, 600, { ls: 0.08, color: C.warn })}>2 ALAN</Text>
            </View>

            <View style={{ marginTop: 16 }}>
              <Text style={type(13, 600)}>Ölçülen sıcaklık (°C)</Text>
              <Text style={[type(11.5, 400, { color: C.t3 }), { marginTop: 3 }]}>Kabul aralığı: 0 – {TEMP_LIMIT} °C</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                {TEMP_OPTIONS.map(v => {
                  const on = temp === v;
                  const bad = v > TEMP_LIMIT;
                  return (
                    <Tap
                      key={v}
                      accessibilityState={{ selected: on }}
                      onPress={() => setTemp(v)}
                      style={{
                        flex: 1, height: 52, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
                        borderColor: on ? (bad ? tint.crit(0.5) : tint.lime(0.45)) : C.bds,
                        backgroundColor: on ? (bad ? tint.crit(0.12) : tint.lime(0.1)) : C.chip,
                      }}
                    >
                      <Text style={type(15, 600, { family: 'mono', color: on ? (bad ? C.crit : C.lime) : C.t2 })}>{v}°</Text>
                    </Tap>
                  );
                })}
              </View>
            </View>

            {overLimit && (
              <Rise duration={200} style={{ flexDirection: 'row', gap: 10, borderWidth: 1, borderColor: tint.crit(0.3), backgroundColor: tint.crit(0.08), borderRadius: 14, paddingVertical: 13, paddingHorizontal: 14, marginTop: 12 }}>
                <View style={{ marginTop: 1 }}><WarnIcon size={15} stroke={2.2} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={type(13, 600, { color: C.crit })}>Limit aşıldı — uygunsuzluk açılacak</Text>
                  <Text style={[type(11.5, 400, { lh: 1.45, color: C.t2 }), { marginTop: 3 }]}>{temp} °C, {TEMP_LIMIT} °C limitinin üzerinde. Kaydı tamamladığında düzeltici faaliyet otomatik açılır.</Text>
                </View>
              </Rise>
            )}

            <View style={{ marginTop: 18 }}>
              <Text style={type(13, 600)}>Fotoğraf</Text>
              <Text style={[type(11.5, 400, { color: C.t3 }), { marginTop: 3 }]}>Termometre ekranı görünecek şekilde</Text>
              <Tap
                onPress={() => setPhoto(p => !p)}
                style={{
                  height: 96, marginTop: 10, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 6,
                  borderColor: photo ? tint.lime(0.45) : C.bds, backgroundColor: photo ? tint.lime(0.07) : C.chip,
                }}
              >
                <CameraIcon color={photo ? C.lime : C.t2} />
                <Text style={type(12.5, 600, { color: photo ? C.lime : C.t2 })}>{photo ? 'Fotoğraf eklendi ✓' : 'Fotoğraf çek'}</Text>
              </Tap>
            </View>
          </Card>

          <Card radius={22} style={{ paddingVertical: 15, paddingHorizontal: 16 }}>
            <Eyebrow>GEÇMİŞ</Eyebrow>
            <View style={{ flexDirection: 'row', gap: 5, marginTop: 12 }}>
              {TEMP_HISTORY.map((v, i) => (
                <View key={i} accessibilityLabel={v === 0 ? 'Uygunsuzluk' : 'Tamam'} style={{ flex: 1, height: 26, borderRadius: 5, backgroundColor: v === 0 ? tint.crit(0.55) : v === 2 ? tint.warn(0.5) : tint.lime(0.32) }} />
              ))}
            </View>
            <Text style={[type(11.5, 400, { color: C.t2 }), { marginTop: 10 }]}>Son 14 gün · 2 uygunsuzluk. Bu ünite ayda 4. kez limit aştı.</Text>
          </Card>
        </>
      )}

      <PrimaryButton label={evidenceOk ? 'Görevi tamamla' : 'Kanıt bekleniyor'} onPress={complete} disabled={!evidenceOk} style={{ marginTop: 2, boxShadow: '0 4px 24px rgba(198,255,61,0.22)' }} />
      {task.needsEvidence && <Text style={[type(11.5, 400, { color: C.t3 }), { textAlign: 'center' }]}>Kanıt tamamlanmadan görev kapatılamaz</Text>}
    </Screen>
  );
}
