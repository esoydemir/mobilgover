import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { useQueue, type Op } from '../api/queue';
import { Screen } from '../components/Screen';
import { Empty } from '../components/states';
import { Card, Eyebrow, GhostButton, PrimaryButton } from '../components/ui';
import { fmtDateTime } from '../features/dates';
import { C, tint, type } from '../theme';

const STATUS: Record<Op['status'], [string, string]> = {
  pending: ['Cihazda · gönderilecek', C.warn], syncing: ['Gönderiliyor', C.info],
  failed: ['Sunucu kabul etmedi', C.crit], conflict: ['Çakışma · başka bir kayıtla çelişiyor', C.crit],
};

/** Every record still on the device, with its state. Nothing is dropped without the user deciding. */
export default function SyncRoute() {
  const { ops, recent, online, syncing, syncNow, retry, discard, authRequired } = useQueue();
  return (
    <Screen title="Eşitleme" titleEn="Sync status">
      <Card border={online === false ? tint.warn(0.35) : C.bd}>
        <Eyebrow>{online === false ? 'ÇEVRİMDIŞI' : syncing ? 'EŞİTLENİYOR' : 'BAĞLANTI'}</Eyebrow>
        <Text testID="sync-summary" style={[type(15, 600), { marginTop: 8 }]}>{ops.length ? `${ops.length} kayıt bu cihazda, sunucuda değil` : 'Tüm kayıtlar sunucuda'}</Text>
        <Text style={[type(12, 400, { color: C.t2, lh: 1.5 }), { marginTop: 6 }]}>Kayıtlar sırayla ve tekil işlem anahtarıyla gönderilir; tekrar gönderim mükerrer kayıt oluşturmaz. Fotoğraf, sunucu özetini doğrulamadan "gönderildi" sayılmaz.</Text>
        <PrimaryButton testID="sync-now" label={syncing ? 'Gönderiliyor…' : 'Şimdi eşitle'} disabled={syncing || !ops.some(o => o.status === 'pending')} height={44} size={13} style={{ marginTop: 12 }} onPress={() => void syncNow()} />
      </Card>
      {authRequired ? (
        <Card border={tint.warn(0.35)} style={{ gap: 8 }}>
          <Text testID="sync-login-needed" style={type(13.5, 600, { color: C.warn })}>Oturum sona erdi</Text>
          <Text style={type(12, 400, { color: C.t2, lh: 1.5 })}>Bekleyen kayıtlar cihazda duruyor ve silinmedi. Aynı hesapla yeniden giriş yapınca sırayla gönderilir.</Text>
          <GhostButton label="Giriş yap" height={38} size={12} onPress={() => router.push('/login')} />
        </Card>
      ) : null}
      {ops.length === 0 ? <Empty title="Bekleyen kayıt yok" /> : null}
      {ops.map(o => (
        <Card key={o.id} border={o.status === 'failed' || o.status === 'conflict' ? tint.crit(0.35) : tint.warn(0.3)} style={{ gap: 6 }}>
          <Text style={type(13.5, 600)}>{o.label}</Text>
          <Text style={type(12, 600, { color: STATUS[o.status][1] })}>{STATUS[o.status][0]}</Text>
          {o.error ? <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>{o.error}</Text> : null}
          <Text style={type(11, 400, { color: C.t3 })}>Cihazda oluşturuldu: {fmtDateTime(o.createdAt)} · deneme {o.attempts}{o.file ? ` · dosya ${Math.round(o.file.size / 1024)} KB${o.evidenceId ? ' · kayıt açıldı, dosya bekleniyor' : ''}` : ''}</Text>
          {o.status === 'failed' || o.status === 'conflict' ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <GhostButton label="Tekrar dene" height={38} size={12} style={{ flex: 1 }} onPress={() => retry(o.id)} />
              <GhostButton label="Bu kaydı sil" height={38} size={12} color={C.crit} border={tint.crit(0.35)} style={{ flex: 1 }} onPress={() => discard(o.id)} />
            </View>
          ) : null}
        </Card>
      ))}
      {recent.length > 0 ? (
        <Card>
          <Eyebrow>SON GÖNDERİLENLER</Eyebrow>
          {recent.slice(0, 10).map(r => <Text key={r.id} style={[type(12, 400, { color: C.t2 }), { marginTop: 6 }]}>✓ {r.label} · {fmtDateTime(r.doneAt)}</Text>)}
        </Card>
      ) : null}
    </Screen>
  );
}
