import { useEffect } from 'react';
import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '@/features/auth/auth-provider';
import { UnreadProvider } from '@/features/notifications/unread-store';
import { RealtimeProvider } from '@/features/realtime/realtime-provider';
import { listenForNotificationTaps } from '@/features/notifications/push-registration';
import { colors } from '@/lib/theme';

export default function AppLayout() {
  const { user, loading } = useAuth();
  useEffect(() => listenForNotificationTaps(), []);
  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!user) return <Redirect href="/(auth)/login" />;
  if (user.mustChangePassword) return <Redirect href="/(auth)/change-password" />;
  return (
    <UnreadProvider>
      <RealtimeProvider>
      <Stack>
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.primary,
          headerTitleStyle: { color: colors.ink },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="task/create" options={{ headerShown: true, title: 'Novi zadatak', headerBackTitle: 'Nazad' }} />
        <Stack.Screen name="task/[id]" options={{ headerShown: true, title: 'Zadatak', headerBackTitle: 'Nazad' }} />
        <Stack.Screen name="vehicle/[id]" options={{ headerShown: true, title: 'Vozilo', headerBackTitle: 'Nazad' }} />
      </Stack>
      </RealtimeProvider>
    </UnreadProvider>
  );
}
