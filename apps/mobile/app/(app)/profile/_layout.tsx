import { Stack } from 'expo-router';
import { colors } from '@/lib/theme';

export default function ProfileStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        contentStyle: { backgroundColor: colors.background },
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.ink },
        headerBackTitle: 'Nazad',
      }}
    >
      <Stack.Screen name="notifications" options={{ title: 'Postavke obavijesti' }} />
      <Stack.Screen name="sessions" options={{ title: 'Aktivne sesije' }} />
    </Stack>
  );
}
