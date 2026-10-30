import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@/features/auth/auth-provider';
import { isOfflineError, mobileApi, toUserMessage, type TaskSummary } from '@/lib/api';
import { displayDateTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import { colors, controlMinHeight, radius, space, type } from '@/lib/theme';
import { EmptyState } from '@/ui/empty-state';
import { ErrorBanner } from '@/ui/error-banner';
import { Screen } from '@/ui/screen';
import { SkeletonList } from '@/ui/skeleton';
import { StatusBadge } from '@/ui/status-badge';

type TaskListMode = 'MINE' | 'AVAILABLE';

export default function TasksScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const canViewMine = user?.permissions.includes('task:view') === true || user?.permissions.includes('task:view_all') === true;
  const canClaim = user?.permissions.includes('task:claim') === true;
  const canCreate = user?.permissions.includes('task:create') === true;
  const [mode, setMode] = useState<TaskListMode>(canViewMine ? 'MINE' : 'AVAILABLE');
  const [items, setItems] = useState<TaskSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async (pull = false) => {
    setError(null);
    if (pull) setRefreshing(true);
    else setLoading(true);
    try {
      const result = mode === 'AVAILABLE' ? await mobileApi.tasks() : await mobileApi.myTasks();
      setItems(result.items);
      setTotal(result.total);
      setOffline(false);
    } catch (cause) {
      setOffline(isOfflineError(cause));
      setError(toUserMessage(cause, 'Zadaci se nisu mogli učitati.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [mode]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <Screen>
      {offline ? <ErrorBanner message={t('offlineBanner')} /> : null}
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {canViewMine && canClaim ? (
        <View style={styles.segmented}>
          <ModeButton active={mode === 'MINE'} label="Moji" onPress={() => setMode('MINE')} />
          <ModeButton active={mode === 'AVAILABLE'} label="Slobodni" onPress={() => setMode('AVAILABLE')} />
        </View>
      ) : null}
      {loading ? <SkeletonList /> : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />}
          contentContainerStyle={items.length ? styles.list : styles.emptyList}
          ListEmptyComponent={<EmptyState title={mode === 'MINE' ? 'Nemate zadataka za prikaz' : 'Nema slobodnih zadataka'} hint="Povucite ekran prema dolje da provjerite ponovo." />}
          ListFooterComponent={total > items.length ? <Text style={styles.more}>{t('loadMoreHint')}</Text> : null}
          renderItem={({ item }) => <TaskCard item={item} showStatus={mode === 'MINE'} />}
        />
      )}
      {canCreate ? (
        <Pressable testID="task-create-open" accessibilityRole="button" accessibilityLabel="Kreiraj zadatak" onPress={() => { if (!offline) router.push('/task/create'); }} disabled={offline} style={[styles.fab, offline && styles.fabDisabled]}>
          <Text style={[styles.fabText, offline && styles.fabTextOff]}>+</Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}

function ModeButton({ active, label, onPress }: { active: boolean; label: string; onPress(): void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: active }} style={[styles.modeButton, active && styles.modeButtonActive]}>
      <Text style={[styles.modeText, active && styles.modeTextActive]}>{label}</Text>
    </Pressable>
  );
}

function TaskCard({ item, showStatus }: { item: TaskSummary; showStatus: boolean }) {
  return (
    <Link href={{ pathname: '/task/[id]', params: { id: item.id } }} asChild>
      <Pressable style={({ pressed }) => [styles.card, pressed && styles.pressed]} accessibilityRole="button">
        <View style={styles.cardTop}>
          <Text style={styles.code}>{item.code}</Text>
          <View style={styles.badges}>
            {showStatus ? <StatusBadge value={item.status} domain="taskStatus" /> : null}
            <StatusBadge value={item.priority} domain="taskPriority" />
          </View>
        </View>
        <Text style={styles.cardTitle}>{item.title}</Text>
        <Text style={styles.meta}>{item.taskTypeName}{item.vehicleInternalNo ? ` · ${item.vehicleInternalNo}` : ''}</Text>
        <Text style={styles.due}>Rok: {displayDateTime(item.dueAt) ?? 'Bez roka'}</Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  segmented: { flexDirection: 'row', gap: space[2], padding: 4, marginBottom: space[3], backgroundColor: colors.surfaceMuted, borderRadius: 13 },
  modeButton: { flex: 1, minHeight: controlMinHeight, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  modeButtonActive: { backgroundColor: colors.primary },
  modeText: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  modeTextActive: { color: colors.primaryFg },
  list: { gap: space[3], paddingBottom: 96 },
  emptyList: { flexGrow: 1, justifyContent: 'center', paddingBottom: 96 },
  card: { padding: space[4], borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 7 },
  pressed: { opacity: 0.8 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  code: { color: colors.muted, fontWeight: '700', fontSize: 12 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  meta: { color: colors.muted, fontSize: 14 },
  due: { color: colors.ink, fontSize: 13, marginTop: 3 },
  more: { color: colors.muted, ...type.sm, textAlign: 'center', paddingVertical: space[3] },
  fab: { position: 'absolute', right: space[4], bottom: space[4], width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  fabDisabled: { backgroundColor: colors.surfaceMuted },
  fabText: { color: colors.primaryFg, fontSize: 28, fontWeight: '700', lineHeight: 32 },
  fabTextOff: { color: colors.muted },
});
