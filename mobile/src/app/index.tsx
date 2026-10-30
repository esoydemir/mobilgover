import { Screen } from '../components/Screen';
import { OwnerHome } from '../screens/OwnerHome';
import { EmployeeHome, HqHome, ProviderHome } from '../screens/PersonaHomes';
import { useApp } from '../state/app';

/** Home tab: each persona lands on its own command center. */
export default function HomeRoute() {
  const { persona } = useApp();
  return (
    <Screen gap={persona === 'owner' ? 13 : 12}>
      {persona === 'owner' && <OwnerHome />}
      {persona === 'hq' && <HqHome />}
      {persona === 'employee' && <EmployeeHome />}
      {persona === 'provider' && <ProviderHome />}
    </Screen>
  );
}
