import { Text, View } from 'react-native';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { ErrorBox } from '../components/states';
import { Card, Eyebrow, PrimaryButton } from '../components/ui';
import { fmtDate } from './dates';
import { ROLE_LABEL } from './labels';
import { useState } from 'react';
import { C, tint, type } from '../theme';

type Invitation = { id: string; role: string; company_name: string; site_name: string | null; invite_expires_at: string; invited_by_email: string | null };

/** Open invitations for this e-mail. Access starts only after accepting. */
export function Invitations({ onAccepted }: { onAccepted?: () => void }) {
  const { call, refresh, selectCompany } = useSession();
  const q = useApi<Invitation[]>('/me/invitations');
  const [error, setError] = useState<string | null>(null);
  if (!q.data?.length && !q.error) return null;
  return (
    <Card border={tint.lime(0.35)} style={{ gap: 10 }}>
      <Eyebrow>SANA GELEN DAVETLER</Eyebrow>
      {q.error ? <ErrorBox message={q.error} /> : null}
      {(q.data ?? []).map(i => (
        <View key={i.id} style={{ gap: 6 }}>
          <Text style={type(14, 600)}>{i.company_name}{i.site_name ? ` · ${i.site_name}` : ''}</Text>
          <Text style={type(12, 400, { color: C.t2 })}>{ROLE_LABEL[i.role] ?? i.role}{i.invited_by_email ? ` · davet eden: ${i.invited_by_email}` : ''} · son gün {fmtDate(i.invite_expires_at)}</Text>
          <PrimaryButton testID="invite-accept" label="Daveti kabul et" height={42} size={12.5} glow={false}
            onPress={async () => {
              setError(null);
              try {
                const r = await call<{ companyId: string }>('POST', `/me/invitations/${i.id}/accept`);
                await refresh(); selectCompany(r.companyId); onAccepted?.();
              } catch (e) { setError(errorText(e)); await q.reload(); }
            }} />
        </View>
      ))}
      {error ? <ErrorBox message={error} /> : null}
    </Card>
  );
}
