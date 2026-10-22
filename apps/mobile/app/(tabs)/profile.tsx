import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/features/auth/auth-provider';
import { mobileApi, toUserMessage, type ActiveSession } from '@/lib/api';
import { colors } from '@/lib/theme';

const DATE_FORMAT = new Intl.DateTimeFormat('bs-BA', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Sarajevo',
});

function sessionDevice(session: ActiveSession): string {
  const model = session.deviceInfo?.model;
  if (model) return model;
  if (session.clientType === 'MOBILE_ANDROID') return 'Android uređaj';
  if (session.clientType === 'MOBILE_IOS') return 'iOS uređaj';
  return 'Web preglednik';
}

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [loggingOutAll, setLoggingOutAll] = useState(false);
  const canManageSessions = user?.permissions.includes('auth:manage_sessions') === true;

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

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const logout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  const revoke = (session: ActiveSession) =>
    Alert.alert(
      'Odjaviti uređaj?',
      `Sesija za uređaj „${sessionDevice(session)}” bit će odjavljena${session.id === mobileApi.currentSessionId() ? ', uključujući ovaj telefon' : ''}.`,
      [
        { text: 'Odustani', style: 'cancel' },
        {
          text: 'Odjavi uređaj',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusySessionId(session.id);
              setSessionError(null);
              try {
                await mobileApi.revokeSession(session.id);
                if (session.id === mobileApi.currentSessionId()) {
                  await signOut();
                } else {
                  await loadSessions();
                }
              } catch (cause) {
                setSessionError(toUserMessage(cause, 'Sesiju nije moguće odjaviti.'));
              } finally {
                setBusySessionId(null);
              }
            })();
          },
        },
      ],
    );

  const revokeAll = () =>
    Alert.alert('Odjaviti sve uređaje?', 'Bit ćete odjavljeni sa svih uređaja, uključujući ovaj telefon.', [
      { text: 'Odustani', style: 'cancel' },
      {
        text: 'Odjavi sve',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setLoggingOutAll(true);
            try {
              await mobileApi.logoutAll();
              await signOut();
            } catch (cause) {
              setSessionError(
                toUserMessage(cause, 'Odjava sa svih uređaja nije uspjela.'),
              );
            } finally {
              setLoggingOutAll(false);
            }
          })();
        },
      },
    ]);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.initials}>{`${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`}</Text>
        </View>
        <Text style={styles.name}>
          {user?.displayName ?? `${user?.firstName ?? ''} ${user?.lastName ?? ''}`}
        </Text>
        <Text style={styles.email}>{user?.email}</Text>
        {user?.roles.map((role) => (
          <Text key={role.id} style={styles.role}>
            {role.name}
          </Text>
        ))}
      </View>
      {user?.mustChangePassword ? (
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Promjena lozinke je obavezna</Text>
          <Text style={styles.email}>Promijenite lozinku kroz aplikaciju prije nastavka korištenja.</Text>
        </View>
      ) : null}
      <View style={styles.info}>
        <Text style={styles.infoLabel}>Uloga</Text>
        <Text style={styles.infoValue}>Pristup i dozvole se provjeravaju na serveru.</Text>
      </View>

      {canManageSessions ? (
        <View style={styles.sessionsCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeading}>
              <Text style={styles.sectionTitle}>Aktivne sesije</Text>
              <Text style={styles.sectionHint}>Uređaji prijavljeni na vaš nalog</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Osvježi sesije"
              onPress={() => void loadSessions()}
              disabled={loadingSessions}
              style={styles.refreshButton}
            >
              <Text style={styles.refreshText}>Osvježi</Text>
            </Pressable>
          </View>
          {loadingSessions && sessions.length === 0 ? <ActivityIndicator color={colors.primary} /> : null}
          {sessionError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {sessionError}
            </Text>
          ) : null}
          {!loadingSessions && sessions.length === 0 && !sessionError ? (
            <Text style={styles.empty}>Nema aktivnih sesija za prikaz.</Text>
          ) : null}
          {sessions.map((session) => (
            <View key={session.id} style={styles.session}>
              <View style={styles.sessionText}>
                <Text style={styles.device}>
                  {sessionDevice(session)}
                  {session.id === mobileApi.currentSessionId() ? ' · Ovaj uređaj' : ''}
                </Text>
                <Text style={styles.sessionMeta}>
                  Prijavljeno: {DATE_FORMAT.format(new Date(session.createdAt))}
                </Text>
                <Text style={styles.sessionMeta}>
                  {session.ipAddress ? `IP adresa: ${session.ipAddress}` : `Klijent: ${session.clientType}`}
                </Text>
                {session.lastUsedAt ? (
                  <Text style={styles.sessionMeta}>
                    Zadnja aktivnost: {DATE_FORMAT.format(new Date(session.lastUsedAt))}
                  </Text>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Odjavi uređaj ${sessionDevice(session)}`}
                onPress={() => revoke(session)}
                disabled={busySessionId !== null || loggingOutAll}
                style={styles.revokeButton}
              >
                {busySessionId === session.id ? (
                  <ActivityIndicator color={colors.danger} />
                ) : (
                  <Text style={styles.revokeText}>Odjavi</Text>
                )}
              </Pressable>
            </View>
          ))}
          <Pressable
            accessibilityRole="button"
            onPress={revokeAll}
            disabled={loggingOutAll || busySessionId !== null}
            style={({ pressed }) => [styles.logoutAll, pressed && styles.pressed]}
          >
            {loggingOutAll ? (
              <ActivityIndicator color={colors.danger} />
            ) : (
              <Text style={styles.logoutAllText}>Odjavi sve uređaje</Text>
            )}
          </Pressable>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={() => void logout()}
        disabled={signingOut}
        style={({ pressed }) => [styles.logout, pressed && styles.pressed]}
      >
        {signingOut ? (
          <ActivityIndicator color={colors.danger} />
        ) : (
          <Text style={styles.logoutText}>Odjavi se</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, padding: 18, gap: 14, backgroundColor: colors.background },
  card: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
    gap: 8,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: '#E8F3F0',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  initials: { color: colors.primaryDark, fontSize: 24, fontWeight: '800' },
  name: { color: colors.ink, fontSize: 20, fontWeight: '800' },
  email: { color: colors.muted, fontSize: 14, textAlign: 'center' },
  role: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
    backgroundColor: '#E8F3F0',
    borderRadius: 99,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: 3,
  },
  notice: { padding: 14, backgroundColor: '#FFF4D6', borderRadius: 14, gap: 6 },
  noticeTitle: { color: colors.warning, fontSize: 14, fontWeight: '800' },
  info: { padding: 15, backgroundColor: colors.surface, borderRadius: 14, gap: 5 },
  infoLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  infoValue: { color: colors.ink, fontSize: 14 },
  sessionsCard: {
    padding: 16,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sectionHeading: { gap: 3 },
  sectionTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  sectionHint: { color: colors.muted, fontSize: 12 },
  refreshButton: { padding: 8 },
  refreshText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  session: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sessionText: { flex: 1, gap: 4 },
  device: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  sessionMeta: { color: colors.muted, fontSize: 12 },
  revokeButton: {
    minWidth: 68,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FDECEC',
    borderRadius: 10,
    paddingHorizontal: 10,
  },
  revokeText: { color: colors.danger, fontSize: 13, fontWeight: '700' },
  empty: { color: colors.muted, fontSize: 13, paddingVertical: 8 },
  error: { color: colors.danger, fontSize: 13 },
  logoutAll: {
    minHeight: 46,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FDECEC',
    borderRadius: 10,
    marginTop: 2,
  },
  logoutAllText: { color: colors.danger, fontSize: 14, fontWeight: '800' },
  logout: {
    minHeight: 50,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FDECEC',
    borderRadius: 12,
    marginTop: 'auto',
  },
  pressed: { opacity: 0.8 },
  logoutText: { color: colors.danger, fontSize: 15, fontWeight: '800' },
});
