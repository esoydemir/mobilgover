import { Screen } from '../components/Screen';
import { EquipmentEditor } from '../features/EquipmentEditor';

export default function EquipmentRoute() {
  return (
    <Screen title="Ekipmanlar" titleEn="Equipment">
      <EquipmentEditor />
    </Screen>
  );
}
