import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '@/features/auth/auth-provider';
import { colors } from '@/lib/theme';

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.primary,
          headerTitleStyle: { color: colors.ink },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="task/create"
          options={{ headerShown: true, title: 'Novi zadatak', headerBackTitle: 'Nazad' }}
        />
        <Stack.Screen
          name="task/[id]"
          options={{ headerShown: true, title: 'Zadatak', headerBackTitle: 'Nazad' }}
        />
        <Stack.Screen
          name="vehicle/[id]"
          options={{ headerShown: true, title: 'Vozilo', headerBackTitle: 'Nazad' }}
        />
      </Stack>
    </AuthProvider>
  );
}
