import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '@/features/auth/auth-provider';
import { openNotificationLink } from '@/features/notifications/push-registration';
import { useUnreadCount } from '@/features/notifications/unread-store';
import { mobileApi, toUserMessage, type NotificationSummary } from '@/lib/api';
import { displayDateTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import { colors, radius, space, type } from '@/lib/theme';
import { EmptyState } from '@/ui/empty-state';
import { ErrorBanner } from '@/ui/error-banner';
import { Screen } from '@/ui/screen';
import { SkeletonList } from '@/ui/skeleton';

export default function NotificationsScreen() {
  const { user } = useAuth();
  const unread = useUnreadCount();
  const canView = user?.permissions.includes('notification:view') === true;
  const canMarkRead = user?.permissions.includes('notification:mark_read') === true;
  const [items, setItems] = useState<NotificationSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [markingAll, setMarkingAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const load = useCallback(async (pull = false) => {
    if (!canView) return;
    if (pull) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [result, count] = await Promise.all([mobileApi.notifications(), mobileApi.unreadNotificationCount()]);
      setItems(result.items);
      setTotal(result.total);
      unread.setCount(count.count);
    } catch (cause) {
      setError(toUserMessage(cause, 'Obavijesti trenutno nisu dostupne.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [canView, unread]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const markRead = async (item: NotificationSummary) => {
    if (item.isRead || markingId || !canMarkRead) return;
    setMarkingId(item.id);
    setError(null);
    try {
      const updated = await mobileApi.markNotificationRead(item.id);
      setItems((current) => current.map((candidate) => candidate.id === updated.id ? updated : candidate));
      unread.setCount(Math.max(0, unread.count - 1));
    } catch (cause) {
      setError(toUserMessage(cause, 'Obavijest nije označena kao pročitana.'));
    } finally {
      setMarkingId(null);
    }
  };

  if (!canView) return <Screen><ErrorBanner message={t('noPermission')} /></Screen>;

  return (
    <Screen>
      <View style={styles.heading}>
        <Text style={styles.headingSub}>{unread.count} nepročitanih</Text>
        {canMarkRead && unread.count > 0 ? (
          <Pressable accessibilityRole="button" onPress={() => {
            void (async () => {
              setMarkingAll(true);
              try {
                await mobileApi.markAllNotificationsRead();
                setItems((current) => current.map((item) => ({ ...item, isRead: true, status: 'READ' as const, readAt: new Date().toISOString() })));
                unread.setCount(0);
              } catch (cause) {
                setError(toUserMessage(cause, 'Obavijesti nije moguće označiti kao pročitane.'));
              } finally {
                setMarkingAll(false);
              }
            })();
          }} disabled={markingAll} style={styles.markAll}><Text style={styles.markAllText}>{markingAll ? 'Označavanje…' : 'Pročitaj sve'}</Text></Pressable>
        ) : null}
      </View>
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {loading && items.length === 0 ? (
        <SkeletonList />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={items.length ? styles.list : styles.emptyList}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />}
          ListEmptyComponent={<EmptyState title="Nema obavijesti" hint="Nove obavijesti će se prikazati ovdje." />}
          ListFooterComponent={total > items.length ? <Text style={styles.muted}>{t('loadMoreHint')}</Text> : null}
          renderItem={({ item }) => (
            <Pressable accessibilityRole="button" onPress={() => { void markRead(item); openNotificationLink(item.linkToType, item.linkToId); }} disabled={markingId !== null || (!item.isRead && !canMarkRead)} style={[styles.card, !item.isRead && styles.unread]}>
              <View style={styles.row}>
                <View style={[styles.icon, !item.isRead && styles.iconUnread]}>
                  <MaterialCommunityIcons name={item.isRead ? 'bell-outline' : 'bell-badge'} size={21} color={item.isRead ? colors.muted : colors.primary} />
                </View>
                <View style={styles.content}>
                  <Text style={styles.title}>{item.title}</Text>
                  {item.body ? <Text style={item.isRead ? styles.body : styles.bodyUnread}>{item.body}</Text> : null}
                  <Text style={styles.date}>{displayDateTime(item.createdAt)}</Text>
                </View>
              </View>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  headingSub: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  markAll: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 8 },
  markAllText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  list: { gap: 10, paddingBottom: 24 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 14 },
  unread: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  iconUnread: { backgroundColor: colors.primarySoft },
  content: { flex: 1, gap: 5 },
  title: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  body: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  bodyUnread: { color: colors.ink, fontSize: 13, lineHeight: 20 },
  date: { color: colors.muted, ...type.sm },
  muted: { color: colors.muted, ...type.sm, textAlign: 'center' },
});
