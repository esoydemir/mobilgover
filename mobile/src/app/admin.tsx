import { AdminLegacy } from '../features/AdminLegacy';
import { useDesktop } from '../features/desktop';
import { Overview } from '../desk/Overview';

/** Masaüstü tarayıcı: Genel Bakış (bekleyen işler, önce hangisi). Telefon: mevcut yönetim ekranı. */
export default function AdminRoute() {
  return useDesktop() ? <Overview /> : <AdminLegacy />;
}
