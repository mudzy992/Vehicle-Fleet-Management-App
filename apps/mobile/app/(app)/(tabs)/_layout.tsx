import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '@/features/auth/auth-provider';
import { useUnreadCount } from '@/features/notifications/unread-store';
import { colors } from '@/lib/theme';

export default function TabsLayout() {
  const { user } = useAuth();
  const unread = useUnreadCount();
  const canViewVehicles = user?.permissions.includes('vehicle:view') === true;
  const canViewNotifications = user?.permissions.includes('notification:view') === true;
  useEffect(() => {
    if (canViewNotifications) void unread.refresh();
  }, [canViewNotifications, unread]);

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { color: colors.ink, fontWeight: '700' },
        headerTintColor: colors.primary,
        tabBarStyle: {
          height: 64,
          paddingTop: 6,
          paddingBottom: 8,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'Moji zadaci',
          tabBarLabel: 'Zadaci',
          tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="clipboard-list-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="vehicles"
        options={{
          href: canViewVehicles ? undefined : null,
          title: 'Vozila',
          tabBarLabel: 'Vozila',
          tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="car-multiple" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          href: canViewNotifications ? undefined : null,
          title: 'Obavijesti',
          tabBarLabel: 'Obavijesti',
          tabBarBadge: canViewNotifications && unread.count > 0 ? unread.count : undefined,
          tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="bell-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarLabel: 'Profil',
          tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="account-circle-outline" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
