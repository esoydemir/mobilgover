import { Redirect } from 'expo-router';
import { AdminLegacy } from '../features/AdminLegacy';
import { useDesktop } from '../features/desktop';
import { Page } from '../desk/Shell';

/** Kural sürümlerinin incelemesi, onayı ve yayını (mevcut işlevler). Masaüstünde kabuğun içinde açılır. */
export default function RulesRoute() {
  return useDesktop() ? <Page nav="kurallar" title="Kural Sürümleri"><AdminLegacy rulesOnly /></Page> : <Redirect href={'/admin' as never} />;
}
