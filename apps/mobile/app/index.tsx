import { Link, Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/features/auth/auth-provider';
import { colors } from '@/lib/theme';

export default function IndexScreen() {
  const { user, loading, error, retryRestore } = useAuth();
  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /><Text style={styles.text}>Provjera sesije…</Text></View>;
  if (user?.mustChangePassword) return <Redirect href="/(auth)/change-password" />;
  if (user) return <Redirect href="/(tabs)/tasks" />;
  if (!error) return <Redirect href="/(auth)/login" />;
  return (
    <View style={styles.center}>
      <Text style={styles.title}>Veza nije dostupna</Text>
      <Text style={styles.text}>{error}</Text>
      <Text accessibilityRole="button" onPress={() => void retryRestore()} style={styles.button}>Pokušaj ponovo</Text>
      <Link href="/(auth)/login" style={styles.link}>Idi na prijavu</Link>
    </View>
  );
}

const styles = StyleSheet.create({ center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }, title: { color: colors.ink, fontSize: 22, fontWeight: '700' }, text: { color: colors.muted, fontSize: 16, textAlign: 'center' }, button: { backgroundColor: colors.primary, color: '#fff', fontWeight: '700', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, overflow: 'hidden' }, link: { color: colors.primary, padding: 12 } });
