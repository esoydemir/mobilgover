import { Redirect, useLocalSearchParams } from 'expo-router';
import { useDesktop } from '../../features/desktop';
import { LegislationDetail } from '../../features/LegislationDetail';

/** One detected change. Phone: its own screen. Desktop browser: the same record opens inside the legislation desk. */
export default function LegislationDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const desktop = useDesktop();
  if (desktop) return <Redirect href={`/legislation?sel=${String(id)}` as never} />;
  return <LegislationDetail id={String(id)} />;
}
