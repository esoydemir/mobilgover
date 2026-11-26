import { Redirect } from 'expo-router';
import { useDesktop } from '../features/desktop';
import { Users } from '../desk/Users';

/** Yalnız masaüstü çalışma alanı; telefonda Yönetim ekranına döner. */
export default function Route() {
  return useDesktop() ? <Users /> : <Redirect href={'/admin' as never} />;
}
