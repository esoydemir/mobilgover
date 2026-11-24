import { Screen } from '../components/Screen';
import { ActivityStatus } from '../features/ActivityStatus';
import { ProfileQuestions, type ProfileDiff } from '../features/ProfileQuestions';
import { ProfileDiffCard } from '../features/ProfileDiffCard';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useUi } from '../state/app';

export default function ProfileRoute() {
  const { showToast } = useUi();
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const [diff, setDiff] = useState<ProfileDiff | null>(null);
  const [rev, setRev] = useState(0); // faaliyet değişince sorular yeniden yüklenir
  return (
    <Screen title="İşletme profili">
      <ActivityStatus onChanged={() => setRev(r => r + 1)} />
      {diff ? <ProfileDiffCard diff={diff} /> : null}
      <ProfileQuestions key={rev} focus={focus} onSaved={(n, d) => { setDiff(n && d ? d : null); showToast(n ? `${n} yanıt kaydedildi` : 'Değişiklik yok', 'Yükümlülükler yeniden hesaplandı'); }} />
    </Screen>
  );
}
