import { Redirect, Tabs } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import { useAuth } from '@/features/auth/auth-provider';
import { colors } from '@/lib/theme';

export default function TabsLayout() {
  const { user, loading } = useAuth();
  if (loading) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator color={colors.primary} /></View>;
  if (!user) return <Redirect href="/(auth)/login" />;
  return (
    <Tabs screenOptions={{ headerTitleStyle: { color: colors.ink, fontWeight: '700' }, tabBarActiveTintColor: colors.primary, tabBarInactiveTintColor: colors.muted, tabBarStyle: { height: 64, paddingTop: 6, paddingBottom: 8 }, tabBarLabelStyle: { fontSize: 12, fontWeight: '600' } }}>
      <Tabs.Screen name="tasks" options={{ title: 'Moji zadaci', tabBarLabel: 'Zadaci', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>✓</Text> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profil', tabBarLabel: 'Profil', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>●</Text> }} />
    </Tabs>
  );
}
