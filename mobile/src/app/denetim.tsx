import { Redirect } from 'expo-router';
import { useDesktop } from '../features/desktop';
import { Audit } from '../desk/Audit';

/** Yalnız masaüstü çalışma alanı; telefonda Yönetim ekranına döner. */
export default function Route() {
  return useDesktop() ? <Audit /> : <Redirect href={'/admin' as never} />;
}
