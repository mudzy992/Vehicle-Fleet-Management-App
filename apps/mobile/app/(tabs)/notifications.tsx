import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@/features/auth/auth-provider';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { mobileApi, toUserMessage, type NotificationSummary } from '@/lib/api';
import { colors } from '@/lib/theme';

function relativeDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('bs-BA', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function NotificationsScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const canMarkRead = user?.permissions.includes('notification:mark_read') === true;
  const [items, setItems] = useState<NotificationSummary[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [markingAll, setMarkingAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const load = useCallback(async (pull = false) => {
    if (pull) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [result, unread] = await Promise.all([mobileApi.notifications(), mobileApi.unreadNotificationCount()]);
      setItems(result.items);
      setUnreadCount(unread.count);
    } catch (cause) {
      setError(toUserMessage(cause, 'Obavijesti trenutno nisu dostupne.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const markRead = async (item: NotificationSummary) => {
    if (item.isRead || markingId || !canMarkRead) return;
    setMarkingId(item.id);
    setError(null);
    try {
      const updated = await mobileApi.markNotificationRead(item.id);
      setItems((current) => current.map((candidate) => candidate.id === updated.id ? updated : candidate));
      setUnreadCount((count) => Math.max(0, count - 1));
    } catch (cause) {
      setError(toUserMessage(cause, 'Obavijest nije označena kao pročitana.'));
    } finally {
      setMarkingId(null);
    }
  };

  const markAllRead = async () => {
    if (!canMarkRead || unreadCount === 0 || markingAll) return;
    setMarkingAll(true);
    setError(null);
    try {
      await mobileApi.markAllNotificationsRead();
      setItems((current) => current.map((item) => ({ ...item, isRead: true, status: 'READ', readAt: new Date().toISOString() })));
      setUnreadCount(0);
    } catch (cause) {
      setError(toUserMessage(cause, 'Obavijesti nije moguće označiti kao pročitane.'));
    } finally {
      setMarkingAll(false);
    }
  };

  const openNotification = async (item: NotificationSummary) => {
    if (!item.isRead) await markRead(item);
    if (!item.linkToId) return;
    if (item.linkToType === 'TASK') router.push({ pathname: '/task/[id]', params: { id: item.linkToId } });
    else if (item.linkToType === 'VEHICLE') router.push({ pathname: '/vehicle/[id]', params: { id: item.linkToId } });
  };

  const renderItem = ({ item }: { item: NotificationSummary }) => (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: item.isRead }} onPress={() => void openNotification(item)} disabled={markingId !== null || (!item.isRead && !canMarkRead)} style={[styles.card, !item.isRead && styles.unread, !item.isRead && !canMarkRead && styles.readOnly]}>
      <View style={styles.row}>
        <View style={[styles.icon, !item.isRead && styles.iconUnread]}>
          <MaterialCommunityIcons name={item.isRead ? 'bell-outline' : 'bell-badge'} size={21} color={item.isRead ? colors.muted : colors.primary} />
        </View>
        <View style={styles.content}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{item.title}</Text>
            {!item.isRead ? <View style={styles.dot} /> : null}
          </View>
          {item.body ? <Text style={styles.body}>{item.body}</Text> : null}
          <Text style={styles.date}>{relativeDate(item.createdAt)}{markingId === item.id ? ' · Ažuriranje…' : ''}</Text>
        </View>
      </View>
    </Pressable>
  );

  return (
    <View style={styles.page}>
      <View style={styles.heading}>
        <Text style={styles.headingTitle}>Obavijesti</Text>
        <View style={styles.headingActions}>
          <Text style={styles.headingSub}>{unreadCount} nepročitanih</Text>
          {canMarkRead && unreadCount > 0 ? <Pressable accessibilityRole="button" onPress={() => void markAllRead()} disabled={markingAll} style={styles.markAllButton}><Text style={styles.markAllText}>{markingAll ? 'Označavanje…' : 'Pročitaj sve'}</Text></Pressable> : null}
        </View>
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {loading && items.length === 0 ? (
        <View style={styles.state}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>Učitavanje obavijesti…</Text></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={items.length ? styles.list : styles.emptyList}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />}
          ListEmptyComponent={<View style={styles.state}><MaterialCommunityIcons name="bell-sleep-outline" size={36} color={colors.muted} /><Text style={styles.emptyTitle}>Nema obavijesti</Text><Text style={styles.muted}>Nove obavijesti će se prikazati ovdje.</Text></View>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 16, paddingTop: 14 },
  heading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 },
  headingTitle: { color: colors.ink, fontSize: 23, fontWeight: '800' },
  headingActions: { alignItems: 'flex-end', gap: 4 },
  headingSub: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  markAllButton: { paddingVertical: 5, paddingHorizontal: 2 },
  markAllText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  list: { gap: 10, paddingBottom: 24 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 14 },
  unread: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  readOnly: { opacity: 0.8 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  iconUnread: { backgroundColor: colors.primarySoft },
  content: { flex: 1, gap: 5 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, color: colors.ink, fontSize: 15, fontWeight: '800' },
  body: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  date: { color: colors.muted, fontSize: 11, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  state: { alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  emptyTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  muted: { color: colors.muted, fontSize: 13, textAlign: 'center' },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19, marginBottom: 10 },
});
