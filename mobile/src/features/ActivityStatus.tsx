import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import { ErrorBox } from '../components/states';
import { GhostButton } from '../components/ui';
import { C, tint, type } from '../theme';
import { ActivityPicker } from './ActivityPicker';

type Activity = { missing: boolean; codes: string[]; classes: { code: string; title: string | null; known: boolean }[] };

/**
 * Profil ekranındaki faaliyet kartı. Faaliyeti kayıtlı olmayan eski müşteriden mevcut görevlerine dokunmadan istenir:
 * yalnızca bir istem gösterilir, hiçbir yükümlülük bu yüzden değişmez.
 */
export function ActivityStatus({ onChanged }: { onChanged?: () => void }) {
  const { call, company } = useSession();
  const [a, setA] = useState<Activity | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () => { if (company) call<Activity>('GET', `/companies/${company.id}/activity`).then(setA).catch(e => setError(errorText(e))); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [company?.id]);
  if (error) return <ErrorBox message={error} />;
  if (!a) return null;
  return (
    <View style={{ borderWidth: 1, borderColor: a.missing ? tint.warn(0.35) : C.bd, backgroundColor: a.missing ? tint.warn(0.06) : C.card, borderRadius: 20, padding: 15, gap: 10 }}>
      <Text style={type(14, 600)}>Faaliyet (NACE)</Text>
      {a.missing ? (
        <Text style={type(12.5, 400, { lh: 1.5, color: C.t2 })}>Faaliyet kodun kayıtlı değil. Eklersen sana özel sorular açılır. Mevcut görevlerin ve yükümlülüklerin bu yüzden değişmez veya durmaz.</Text>
      ) : a.classes.map(c => (
        <Text key={c.code} style={type(13, 400, { lh: 1.45, color: C.t2 })}>• {c.code} — {c.title ?? 'katalogda yok, incelemede'}</Text>
      ))}
      {editing ? <ActivityPicker onContinue={() => { setEditing(false); load(); onChanged?.(); }} />
        : <GhostButton testID="activity-edit" label={a.missing ? 'Faaliyetimi ekle' : 'Faaliyeti değiştir'} onPress={() => setEditing(true)} />}
    </View>
  );
}
