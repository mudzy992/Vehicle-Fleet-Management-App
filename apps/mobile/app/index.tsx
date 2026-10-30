import { Link, Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/features/auth/auth-provider';
import { colors } from '@/lib/theme';
import { AppButton } from '@/ui/button';
import { Screen } from '@/ui/screen';

export default function IndexScreen() {
  const { user, loading, error, retryRestore } = useAuth();
  if (loading) {
    return (
      <Screen edges={['top', 'left', 'right']}>
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /><Text style={styles.text}>Provjera sesije…</Text></View>
      </Screen>
    );
  }
  if (user?.mustChangePassword) return <Redirect href="/(auth)/change-password" />;
  if (user) return <Redirect href="/tasks" />;
  if (!error) return <Redirect href="/(auth)/login" />;
  return (
    <Screen edges={['top', 'left', 'right']}>
      <View style={styles.center}>
        <Text style={styles.title}>Veza nije dostupna</Text>
        <Text style={styles.error}>{error}</Text>
        <AppButton label="Pokušaj ponovo" onPress={() => void retryRestore()} />
        <Link href="/(auth)/login" style={styles.link}>Idi na prijavu</Link>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  title: { color: colors.ink, fontSize: 22, fontWeight: '700' },
  text: { color: colors.muted, fontSize: 16, lineHeight: 24, textAlign: 'center' },
  error: { color: colors.danger, fontSize: 16, lineHeight: 24, textAlign: 'center' },
  link: { color: colors.primary, padding: 12, fontWeight: '700' },
});
