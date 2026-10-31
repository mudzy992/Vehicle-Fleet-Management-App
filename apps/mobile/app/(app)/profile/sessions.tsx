import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { Stack } from 'expo-router';
import { useAuth } from '@/features/auth/auth-provider';
import { unregisterPushToken } from '@/features/notifications/push-registration';
import { confirmRevoke, confirmRevokeAll, SessionsPanel } from '@/features/profile/sessions-panel';
import { mobileApi, toUserMessage, type ActiveSession } from '@/lib/api';
import { colors, space, type } from '@/lib/theme';
import { Screen } from '@/ui/screen';

export default function ActiveSessionsScreen() {
  const { user, signOut } = useAuth();
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [loggingOutAll, setLoggingOutAll] = useState(false);
  const canManage = user?.permissions.includes('auth:manage_sessions') === true;
  const load = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    setError(null);
    try {
      setSessions(await mobileApi.activeSessions());
    } catch (cause) {
      setError(toUserMessage(cause, 'Sesije se trenutno ne mogu učitati.'));
    } finally {
      setLoading(false);
    }
  }, [canManage]);
  useEffect(() => { void load(); }, [load]);
  if (!canManage) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Aktivne sesije' }} />
        <Text accessibilityRole="alert" style={styles.error}>Nemate pravo za pregled sesija.</Text>
      </Screen>
    );
  }
  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: 'Aktivne sesije' }} />
      <ScrollView contentContainerStyle={styles.page}>
        <SessionsPanel
          sessions={sessions}
          loading={loading}
          error={error}
          busySessionId={busySessionId}
          loggingOutAll={loggingOutAll}
          onRefresh={() => void load()}
          onRevoke={(session) => confirmRevoke(session, () => {
            void (async () => {
              setBusySessionId(session.id);
              try {
                await mobileApi.revokeSession(session.id);
                if (session.id === mobileApi.currentSessionId()) await signOut();
                else await load();
              } catch (cause) {
                setError(toUserMessage(cause, 'Sesiju nije moguće odjaviti.'));
              } finally {
                setBusySessionId(null);
              }
            })();
          })}
          onRevokeAll={() => confirmRevokeAll(() => {
            void (async () => {
              setLoggingOutAll(true);
              try {
                await unregisterPushToken();
                await mobileApi.logoutAll();
                await signOut();
              } catch (cause) {
                setError(toUserMessage(cause, 'Odjava sa svih uređaja nije uspjela.'));
              } finally {
                setLoggingOutAll(false);
              }
            })();
          })}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, padding: space[4], gap: space[3], backgroundColor: colors.background },
  error: { color: colors.danger, ...type.sm, lineHeight: 19, padding: space[4] },
});
