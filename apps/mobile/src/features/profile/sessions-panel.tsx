import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { mobileApi, type ActiveSession } from '@/lib/api';
import { displayDateTime } from '@/lib/format';
import { colors, radius, space } from '@/lib/theme';

function sessionDevice(session: ActiveSession): string {
  const model = session.deviceInfo?.model;
  if (model) return model;
  if (session.clientType === 'MOBILE_ANDROID') return 'Android uređaj';
  if (session.clientType === 'MOBILE_IOS') return 'iOS uređaj';
  return 'Web preglednik';
}

export function SessionsPanel({
  sessions,
  loading,
  error,
  busySessionId,
  loggingOutAll,
  onRefresh,
  onRevoke,
  onRevokeAll,
}: {
  sessions: ActiveSession[];
  loading: boolean;
  error: string | null;
  busySessionId: string | null;
  loggingOutAll: boolean;
  onRefresh(): void;
  onRevoke(session: ActiveSession): void;
  onRevokeAll(): void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Aktivne sesije</Text>
          <Text style={styles.hint}>Uređaji prijavljeni na vaš nalog</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={onRefresh} disabled={loading} style={styles.refresh}>
          <Text style={styles.refreshText}>Osvježi</Text>
        </Pressable>
      </View>
      {loading && sessions.length === 0 ? <ActivityIndicator color={colors.primary} /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {!loading && sessions.length === 0 && !error ? <Text style={styles.empty}>Nema aktivnih sesija za prikaz.</Text> : null}
      {sessions.map((session) => (
        <View key={session.id} style={styles.session}>
          <View style={styles.sessionText}>
            <Text style={styles.device}>{sessionDevice(session)}{session.id === mobileApi.currentSessionId() ? ' · Ovaj uređaj' : ''}</Text>
            <Text style={styles.meta}>Prijavljeno: {displayDateTime(session.createdAt)}</Text>
            <Text style={styles.meta}>{session.ipAddress ? `IP adresa: ${session.ipAddress}` : `Klijent: ${session.clientType}`}</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => onRevoke(session)} disabled={busySessionId !== null || loggingOutAll} style={styles.revoke}>
            {busySessionId === session.id ? <ActivityIndicator color={colors.danger} /> : <Text style={styles.revokeText}>Odjavi</Text>}
          </Pressable>
        </View>
      ))}
      <Pressable accessibilityRole="button" onPress={onRevokeAll} disabled={loggingOutAll || busySessionId !== null} style={styles.logoutAll}>
        {loggingOutAll ? <ActivityIndicator color={colors.danger} /> : <Text style={styles.logoutAllText}>Odjavi sve uređaje</Text>}
      </Pressable>
    </View>
  );
}

export function confirmRevoke(session: ActiveSession, run: () => void): void {
  Alert.alert(
    'Odjaviti uređaj?',
    `Sesija za uređaj „${sessionDevice(session)}” bit će odjavljena${session.id === mobileApi.currentSessionId() ? ', uključujući ovaj telefon' : ''}.`,
    [{ text: 'Odustani', style: 'cancel' }, { text: 'Odjavi uređaj', style: 'destructive', onPress: run }],
  );
}

export function confirmRevokeAll(run: () => void): void {
  Alert.alert('Odjaviti sve uređaje?', 'Bit ćete odjavljeni sa svih uređaja, uključujući ovaj telefon.', [
    { text: 'Odustani', style: 'cancel' },
    { text: 'Odjavi sve', style: 'destructive', onPress: run },
  ]);
}

const styles = StyleSheet.create({
  card: { padding: space[4], backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, gap: space[3] },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  refresh: { minHeight: 48, justifyContent: 'center', padding: 8 },
  refreshText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  session: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border },
  sessionText: { flex: 1, gap: 4 },
  device: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  meta: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  revoke: { minWidth: 68, minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dangerSoft, borderRadius: 10, paddingHorizontal: 10 },
  revokeText: { color: colors.danger, fontSize: 13, fontWeight: '700' },
  empty: { color: colors.muted, fontSize: 13, paddingVertical: 8 },
  error: { color: colors.danger, fontSize: 13 },
  logoutAll: { minHeight: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.dangerSoft, borderRadius: 10 },
  logoutAllText: { color: colors.danger, fontSize: 14, fontWeight: '800' },
});
