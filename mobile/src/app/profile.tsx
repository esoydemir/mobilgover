import { Screen } from '../components/Screen';
import { ActivityStatus } from '../features/ActivityStatus';
import { ProfileQuestions, type ProfileDiff } from '../features/ProfileQuestions';
import { ProfileDiffCard } from '../features/ProfileDiffCard';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useUi } from '../state/app';
import { Text } from 'react-native';
import { useSession } from '../api/session';
import { C, type } from '../theme';

export default function ProfileRoute() {
  const { showToast } = useUi();
  const { sites, siteId } = useSession();
  const siteName = sites.length > 1 ? sites.find(s => s.id === siteId)?.name : undefined;
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const [diff, setDiff] = useState<ProfileDiff | null>(null);
  const [rev, setRev] = useState(0); // faaliyet değişince sorular yeniden yüklenir
  return (
    <Screen title="İşletme profili">
      {siteName ? <Text testID="profile-site" style={type(13, 600, { color: C.t2 })}>Şube: {siteName}. Şubeye ait sorular yalnız bu şube için kaydedilir; başka şube için önce Diğer ekranından şubeyi seç.</Text> : null}
      <ActivityStatus onChanged={() => setRev(r => r + 1)} />
      {diff ? <ProfileDiffCard diff={diff} /> : null}
      <ProfileQuestions key={rev} focus={focus} onSaved={(n, d) => { setDiff(n && d ? d : null); showToast(n ? `${n} yanıt kaydedildi` : 'Değişiklik yok', 'Yükümlülükler yeniden hesaplandı'); }} />
    </Screen>
  );
}
