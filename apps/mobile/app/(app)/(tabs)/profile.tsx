import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '@/features/auth/auth-provider';
import { colors, controlMinHeight, radius, space } from '@/lib/theme';
import { AppButton } from '@/ui/button';
import { Screen } from '@/ui/screen';

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const canManageSessions = user?.permissions.includes('auth:manage_sessions') === true;
  const canManagePreferences = user?.permissions.includes('notification:manage_preferences') === true;
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
          <Pressable accessibilityRole="button" style={styles.row}>
            <Text style={styles.rowText}>Promijeni lozinku</Text>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.muted} />
          </Pressable>
        </Link>
        {canManagePreferences ? (
          <Link href="/profile/notifications" asChild>
            <Pressable accessibilityRole="button" style={styles.row}>
              <Text style={styles.rowText}>Postavke obavijesti</Text>
              <MaterialCommunityIcons name="chevron-right" size={22} color={colors.muted} />
            </Pressable>
          </Link>
        ) : null}
        {canManageSessions ? (
          <Link href="/profile/sessions" asChild>
            <Pressable accessibilityRole="button" style={styles.row}>
              <Text style={styles.rowText}>Aktivne sesije</Text>
              <MaterialCommunityIcons name="chevron-right" size={22} color={colors.muted} />
            </Pressable>
          </Link>
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
  row: { minHeight: controlMinHeight, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[4], backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg },
  rowText: { color: colors.ink, fontSize: 14, fontWeight: '700' },
});
