import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import { EnvBadge } from '../components/Screen';
import { ErrorBox, Field } from '../components/states';
import { GhostButton, PrimaryButton, missingWhy } from '../components/ui';
import { ActivityPicker } from '../features/ActivityPicker';
import { EquipmentEditor } from '../features/EquipmentEditor';
import { Invitations } from '../features/Invitations';
import { ProfileQuestions } from '../features/ProfileQuestions';
import { goRoot } from '../state/app';
import { C, tint, type } from '../theme';
import { dayKey } from '../features/dates';

const STEPS = ['İşletme', 'Faaliyet', 'Profil', 'Ekipman', 'Görevler'];

/** First-run setup: business → profile answers → equipment → first week of tasks. */
export default function SetupRoute() {
  const insets = useSafeAreaInsets();
  const { company, siteId, createCompany, call, logout } = useSession();
  const [step, setStep] = useState(company ? 1 : 0);
  const [name, setName] = useState('');
  const [siteName, setSiteName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<number | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ paddingTop: insets.top + 24, paddingHorizontal: 22, paddingBottom: 60, gap: 14 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', gap: 5 }}>
        {STEPS.map((_, i) => <View key={i} style={{ flex: 1, height: 3, borderRadius: 999, backgroundColor: i <= step ? C.accent : tint.white(0.09) }} />)}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={type(10.5, 600, { ls: 0.12, color: C.lime })}>ADIM {step + 1} / {STEPS.length} · {STEPS[step]!.toLocaleUpperCase('tr')}</Text>
        <EnvBadge />
      </View>

      {step === 0 && (
        <>
          <Invitations onAccepted={() => goRoot('/')} />
          <Text style={type(27, 600, { ls: -0.035, lh: 1.12 })}>İşletmeni oluştur</Text>
          <Text style={type(14, 400, { lh: 1.5, color: C.t2 })}>Pilot kapsamı: yemek hazırlayan tek şubeli kafe/restoran. Sen işletme sahibi olarak eklenirsin.</Text>
          <Field label="İşletme adı" testID="setup-name" value={name} onChangeText={setName} placeholder="ör. Moda Kafe" />
          <Field label="Şube adı" testID="setup-site" value={siteName} onChangeText={setSiteName} placeholder="ör. Moda" />
          <PrimaryButton testID="setup-create" label={busy ? 'Oluşturuluyor…' : 'Oluştur'} disabled={busy || name.trim().length < 2 || siteName.trim().length < 2} why={missingWhy([[name.trim().length < 2, 'işletme adı (en az 2 karakter)'], [siteName.trim().length < 2, 'şube adı (en az 2 karakter)']])}
            onPress={() => run(async () => { await createCompany(name.trim(), siteName.trim()); setStep(1); })} />
          <GhostButton label="Hizmet sağlayıcıyım (uzman profili)" onPress={() => router.push('/pro')} />
          <GhostButton label="Çıkış yap" onPress={logout} />
        </>
      )}

      {step === 1 && (
        <>
          <Text style={type(27, 600, { ls: -0.035, lh: 1.12 })}>Ne iş yapıyorsun?</Text>
          <Text style={type(14, 400, { lh: 1.5, color: C.t2 })}>Faaliyet kodunu (NACE) seç ve onayla. Bundan sonra hangi kuralların sana uygulanacağı bu cevaba ve şube sorularına göre belirlenir.</Text>
          <ActivityPicker onContinue={() => setStep(2)} />
        </>
      )}

      {step === 2 && (
        <>
          <Text style={type(27, 600, { ls: -0.035, lh: 1.12 })}>İşletmeni tanıyalım</Text>
          <Text style={type(14, 400, { lh: 1.5, color: C.t2 })}>Yalnızca yükümlülükleri belirleyen sorular. Emin değilsen "Bilmiyorum" de; o konu "bilgi eksik" olarak kalır, asla "uygulanmaz" sayılmaz.</Text>
          <ProfileQuestions submitLabel="Kaydet ve devam et" onSaved={() => setStep(3)} />
        </>
      )}

      {step === 3 && (
        <>
          <Text style={type(27, 600, { ls: -0.035, lh: 1.12 })}>Ekipmanlar</Text>
          <Text style={type(14, 400, { lh: 1.5, color: C.t2 })}>Sıcaklık kontrolleri her soğutucu için ayrı oluşturulur. Ölçüm yaptığın termometreyi de ekle.</Text>
          <EquipmentEditor />
          <PrimaryButton testID="setup-equipment-next" label="Devam et" onPress={() => setStep(4)} />
        </>
      )}

      {step === 4 && (
        <>
          <Text style={type(27, 600, { ls: -0.035, lh: 1.12 })}>İlk haftanın görevleri</Text>
          <Text style={type(14, 400, { lh: 1.5, color: C.t2 })}>Uygulanan yükümlülüklerden bugünden itibaren 7 günlük görev oluşturulur. Tekrar çalıştırmak mükerrer görev üretmez.</Text>
          {generated !== null ? <Text style={type(15, 600, { color: C.lime })}>{generated} görev hazır.</Text> : null}
          <PrimaryButton testID="setup-generate" label={busy ? 'Oluşturuluyor…' : generated === null ? 'Görevleri oluştur' : 'Ana sayfaya git'} disabled={busy}
            onPress={() => run(async () => {
              if (generated !== null) { goRoot('/'); return; }
              const today = new Date();
              const r = await call<{ created: number }>('POST', `/companies/${company!.id}/tasks/generate`,
                { siteId, fromDay: dayKey(today), toDay: dayKey(new Date(today.getTime() + 6 * 86400_000)) });
              // Görevler profil/ekipman adımlarında zaten oluşmuş olabilir: "0 oluşturuldu" demek yanlış olur, hazır olanı say.
              const open = await call<unknown[]>('GET', `/companies/${company!.id}/tasks?siteId=${siteId}&status=open`);
              setGenerated(Math.max(r.created, open.length));
            })} />
        </>
      )}
      {error ? <ErrorBox message={error} /> : null}
    </ScrollView>
  );
}
