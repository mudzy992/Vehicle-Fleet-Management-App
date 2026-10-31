import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '@/features/auth/auth-provider';
import { ForceUpdateGate } from '@/features/app-release/force-update-gate';
import { colors } from '@/lib/theme';
import { Toaster } from '@/ui/toaster';

export default function RootLayout() {
  return (
    <AuthProvider>
      <ForceUpdateGate>
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
          <Stack.Screen name="(app)" />
        </Stack>
        <Toaster />
      </ForceUpdateGate>
    </AuthProvider>
  );
}
