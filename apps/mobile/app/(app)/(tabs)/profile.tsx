import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { useAuth } from '@/features/auth/auth-provider';
import { unregisterPushToken } from '@/features/notifications/push-registration';
import { PreferencesCard } from '@/features/notifications/preferences-card';
import { confirmRevoke, confirmRevokeAll, SessionsPanel } from '@/features/profile/sessions-panel';
import { mobileApi, toUserMessage, type ActiveSession } from '@/lib/api';
import { colors, controlMinHeight, radius, space } from '@/lib/theme';
import { AppButton } from '@/ui/button';
import { Screen } from '@/ui/screen';

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [loggingOutAll, setLoggingOutAll] = useState(false);
  const canManageSessions = user?.permissions.includes('auth:manage_sessions') === true;
  const canManagePreferences = user?.permissions.includes('notification:manage_preferences') === true;

  const loadSessions = useCallback(async () => {
    if (!canManageSessions) return;
    setLoadingSessions(true);
    setSessionError(null);
    try {
      setSessions(await mobileApi.activeSessions());
    } catch (cause) {
      setSessionError(toUserMessage(cause, 'Sesije se trenutno ne mogu učitati.'));
    } finally {
      setLoadingSessions(false);
    }
  }, [canManageSessions]);

  useEffect(() => { void loadSessions(); }, [loadSessions]);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.card}>
          <View style={styles.avatar}><Text style={styles.initials}>{`${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`}</Text></View>
          <Text style={styles.name}>{user?.displayName ?? `${user?.firstName ?? ''} ${user?.lastName ?? ''}`}</Text>
          <Text style={styles.email}>{user?.email}</Text>
          {user?.roles.map((role) => <Text key={role.id} style={styles.role}>{role.name}</Text>)}
        </View>
        <Link href="/(auth)/change-password" asChild>
          <Pressable accessibilityRole="button" style={styles.password}><Text style={styles.passwordText}>Promijeni lozinku</Text></Pressable>
        </Link>
        {canManagePreferences ? <PreferencesCard /> : null}
        {canManageSessions ? (
          <SessionsPanel
            sessions={sessions}
            loading={loadingSessions}
            error={sessionError}
            busySessionId={busySessionId}
            loggingOutAll={loggingOutAll}
            onRefresh={() => void loadSessions()}
            onRevoke={(session) => confirmRevoke(session, () => {
              void (async () => {
                setBusySessionId(session.id);
                try {
                  await mobileApi.revokeSession(session.id);
                  if (session.id === mobileApi.currentSessionId()) await signOut();
                  else await loadSessions();
                } catch (cause) {
                  setSessionError(toUserMessage(cause, 'Sesiju nije moguće odjaviti.'));
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
                  setSessionError(toUserMessage(cause, 'Odjava sa svih uređaja nije uspjela.'));
                } finally {
                  setLoggingOutAll(false);
                }
              })();
            })}
          />
        ) : null}
        <AppButton testID="profile-logout" label="Odjavi se" variant="danger" loading={signingOut} onPress={() => {
          if (signingOut) return;
          setSigningOut(true);
          void signOut().finally(() => setSigningOut(false));
        }} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, padding: space[4], gap: space[3], backgroundColor: colors.background },
  card: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 24, gap: 8 },
  avatar: { width: 72, height: 72, borderRadius: 24, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  initials: { color: colors.primary, fontSize: 24, fontWeight: '800' },
  name: { color: colors.ink, fontSize: 20, fontWeight: '800' },
  email: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  role: { color: colors.primary, fontSize: 12, fontWeight: '700', backgroundColor: colors.primarySoft, borderRadius: 99, overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 5 },
  password: { minHeight: controlMinHeight, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg },
  passwordText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
});
