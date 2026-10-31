import { ScrollView, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { PreferencesCard } from '@/features/notifications/preferences-card';
import { colors, space } from '@/lib/theme';
import { Screen } from '@/ui/screen';

export default function NotificationSettingsScreen() {
  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: 'Postavke obavijesti' }} />
      <ScrollView contentContainerStyle={styles.page}>
        <PreferencesCard />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, padding: space[4], gap: space[3], backgroundColor: colors.background },
});
