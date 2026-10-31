import { Screen } from '../components/Screen';
import { ProfileQuestions } from '../features/ProfileQuestions';
import { useUi } from '../state/app';

export default function ProfileRoute() {
  const { showToast } = useUi();
  return (
    <Screen title="İşletme profili" titleEn="Business profile">
      <ProfileQuestions onSaved={n => showToast(n ? `${n} yanıt kaydedildi` : 'Değişiklik yok', 'Yükümlülükler yeniden hesaplandı')} />
    </Screen>
  );
}
