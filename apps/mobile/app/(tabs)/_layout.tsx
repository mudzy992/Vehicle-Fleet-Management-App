import { Redirect, Tabs } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '@/features/auth/auth-provider';
import { colors } from '@/lib/theme';

export default function TabsLayout() {
  const { user, loading } = useAuth();
  if (loading) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator color={colors.primary} /></View>;
  if (!user) return <Redirect href="/(auth)/login" />;
  if (user.mustChangePassword) return <Redirect href="/(auth)/change-password" />;
  return (
    <Tabs screenOptions={{ headerTitleStyle: { color: colors.ink, fontWeight: '700' }, tabBarActiveTintColor: colors.primary, tabBarInactiveTintColor: colors.muted, tabBarStyle: { height: 64, paddingTop: 6, paddingBottom: 8 }, tabBarLabelStyle: { fontSize: 12, fontWeight: '600' } }}>
      <Tabs.Screen name="tasks" options={{ title: 'Moji zadaci', tabBarLabel: 'Zadaci', tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="clipboard-list-outline" color={color} size={size} /> }} />
      {user.permissions.includes('vehicle:view') ? <Tabs.Screen name="vehicles" options={{ title: 'Vozila', tabBarLabel: 'Vozila', tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="car-multiple" color={color} size={size} /> }} /> : null}
      {user.permissions.includes('notification:view') ? <Tabs.Screen name="notifications" options={{ title: 'Obavijesti', tabBarLabel: 'Obavijesti', tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="bell-outline" color={color} size={size} /> }} /> : null}
      <Tabs.Screen name="profile" options={{ title: 'Profil', tabBarLabel: 'Profil', tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="account-circle-outline" color={color} size={size} /> }} />
    </Tabs>
  );
}
