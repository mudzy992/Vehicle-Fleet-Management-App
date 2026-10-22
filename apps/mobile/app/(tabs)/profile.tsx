import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/features/auth/auth-provider';
import { colors } from '@/lib/theme';

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const logout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try { await signOut(); } finally { setSigningOut(false); }
  };
  return (
    <View style={styles.page}>
      <View style={styles.card}>
        <View style={styles.avatar}><Text style={styles.initials}>{`${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`}</Text></View>
        <Text style={styles.name}>{user?.displayName ?? `${user?.firstName ?? ''} ${user?.lastName ?? ''}`}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        {user?.roles.map((role) => <Text key={role.id} style={styles.role}>{role.name}</Text>)}
      </View>
      {user?.mustChangePassword ? <View style={styles.notice}><Text style={styles.noticeTitle}>Promjena lozinke je obavezna</Text><Text style={styles.email}>Promijenite lozinku kroz web portal prije nastavka korištenja.</Text></View> : null}
      <View style={styles.info}><Text style={styles.infoLabel}>Uloga</Text><Text style={styles.infoValue}>Pristup i dozvole se provjeravaju na serveru.</Text></View>
      <Pressable accessibilityRole="button" onPress={() => void logout()} disabled={signingOut} style={({ pressed }) => [styles.logout, pressed && styles.pressed]}>
        {signingOut ? <ActivityIndicator color={colors.danger} /> : <Text style={styles.logoutText}>Odjavi se</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({ page: { flex: 1, padding: 18, gap: 14 }, card: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 24, gap: 8 }, avatar: { width: 72, height: 72, borderRadius: 24, backgroundColor: '#E8F3F0', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }, initials: { color: colors.primaryDark, fontSize: 24, fontWeight: '800' }, name: { color: colors.ink, fontSize: 20, fontWeight: '800' }, email: { color: colors.muted, fontSize: 14, textAlign: 'center' }, role: { color: colors.primary, fontSize: 12, fontWeight: '700', backgroundColor: '#E8F3F0', borderRadius: 99, overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 5, marginTop: 3 }, notice: { padding: 14, backgroundColor: '#FFF4D6', borderRadius: 14, gap: 6 }, noticeTitle: { color: colors.warning, fontSize: 14, fontWeight: '800' }, info: { padding: 15, backgroundColor: colors.surface, borderRadius: 14, gap: 5 }, infoLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' }, infoValue: { color: colors.ink, fontSize: 14 }, logout: { minHeight: 50, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FDECEC', borderRadius: 12, marginTop: 'auto' }, pressed: { opacity: 0.8 }, logoutText: { color: colors.danger, fontSize: 15, fontWeight: '800' } });
