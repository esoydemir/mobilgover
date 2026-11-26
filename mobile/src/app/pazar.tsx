import { Redirect } from 'expo-router';
import { useDesktop } from '../features/desktop';
import { Market } from '../desk/Market';

/** Yalnız masaüstü çalışma alanı; telefonda Yönetim ekranına döner. */
export default function Route() {
  return useDesktop() ? <Market /> : <Redirect href={'/admin' as never} />;
}
