import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { useAuth } from '@/features/auth/auth-provider';
import { ApiError, mobileApi, type TaskSummary } from '@/lib/api';
import { colors } from '@/lib/theme';

type TaskListMode = 'MINE' | 'AVAILABLE';

const STATUS_LABELS: Record<string, string> = {
  OPEN: 'Otvoren',
  IN_PROGRESS: 'U toku',
  COMPLETED: 'Završen',
  CANCELLED: 'Otkazan',
};

function dateLabel(value: string | null): string {
  if (!value) return 'Bez roka';
  return new Intl.DateTimeFormat('bs-BA', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Sarajevo',
  }).format(new Date(value));
}

export default function TasksScreen() {
  const { user } = useAuth();
  const canViewMine = user?.permissions.includes('task:view') === true || user?.permissions.includes('task:view_all') === true;
  const canClaim = user?.permissions.includes('task:claim') === true;
  const [mode, setMode] = useState<TaskListMode>(canViewMine ? 'MINE' : 'AVAILABLE');
  const [items, setItems] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (pull = false) => {
    setError(null);
    if (pull) setRefreshing(true);
    else setLoading(true);
    try {
      const result = mode === 'AVAILABLE' ? await mobileApi.tasks() : await mobileApi.myTasks();
      setItems(result.items);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Zadaci se nisu mogli učitati.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [mode]);

  useEffect(() => { void load(); }, [load]);

  const title = mode === 'MINE' ? 'Moji zadaci' : 'Slobodni zadaci';
  const emptyTitle = mode === 'MINE' ? 'Nemate zadataka za prikaz' : 'Nema slobodnih zadataka';
  const emptyHint = mode === 'MINE'
    ? 'Ovdje će se prikazati zadaci koji su vam dodijeljeni ili koje ste preuzeli.'
    : 'Povucite ekran prema dolje da provjerite ponovo.';

  return (
    <View style={styles.page}>
      <View style={styles.heading}>
        <View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{mode === 'MINE' ? 'Zadaci povezani s vašim nalogom.' : 'Preuzmite zadatak koji možete izvršiti.'}</Text>
        </View>
        <Pressable onPress={() => void load(true)} accessibilityRole="button" accessibilityLabel="Osvježi zadatke" style={styles.refresh}>
          <Text style={styles.refreshText}>↻</Text>
        </Pressable>
      </View>

      {canViewMine && canClaim ? (
        <View style={styles.segmented}>
          <ModeButton active={mode === 'MINE'} label="Moji" onPress={() => setMode('MINE')} />
          <ModeButton active={mode === 'AVAILABLE'} label="Slobodni" onPress={() => setMode('AVAILABLE')} />
        </View>
      ) : null}

      {error ? (
        <View style={styles.notice}>
          <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
          <Pressable onPress={() => void load()}><Text style={styles.retry}>Pokušaj ponovo</Text></Pressable>
        </View>
      ) : null}

      {loading ? <ActivityIndicator color={colors.primary} size="large" style={styles.loader} /> : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />}
          contentContainerStyle={items.length ? styles.list : styles.emptyList}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyTitle}>{emptyTitle}</Text><Text style={styles.subtitle}>{emptyHint}</Text></View>}
          renderItem={({ item }) => <TaskCard item={item} showStatus={mode === 'MINE'} />}
        />
      )}
    </View>
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
            {showStatus ? <Text style={[styles.status, item.status === 'IN_PROGRESS' && styles.statusProgress]}>{STATUS_LABELS[item.status] ?? item.status}</Text> : null}
            <Text style={styles.priority}>{item.priority === 'URGENT' ? 'HITNO' : item.priority === 'HIGH' ? 'VISOK' : item.priority === 'LOW' ? 'NIZAK' : 'NORMALAN'}</Text>
          </View>
        </View>
        <Text style={styles.cardTitle}>{item.title}</Text>
        <Text style={styles.meta}>{item.taskTypeName}{item.vehicleInternalNo ? ` · ${item.vehicleInternalNo}` : ''}</Text>
        <Text style={styles.due}>Rok: {dateLabel(item.dueAt)}</Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 18, paddingTop: 14 },
  heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  title: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  subtitle: { color: colors.muted, fontSize: 14, marginTop: 4 },
  refresh: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  refreshText: { color: colors.primary, fontSize: 27 },
  segmented: { flexDirection: 'row', gap: 8, padding: 4, marginBottom: 12, backgroundColor: '#E9EEF2', borderRadius: 13 },
  modeButton: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  modeButtonActive: { backgroundColor: colors.surface, shadowColor: '#102A43', shadowOpacity: 0.08, shadowRadius: 4, elevation: 1 },
  modeText: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  modeTextActive: { color: colors.primaryDark },
  list: { gap: 12, paddingBottom: 20 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  card: { padding: 16, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 7 },
  pressed: { opacity: 0.8 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  code: { color: colors.muted, fontWeight: '700', fontSize: 12 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  status: { color: colors.muted, fontSize: 10, fontWeight: '800', backgroundColor: '#EFF2F5', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 99, overflow: 'hidden' },
  statusProgress: { color: colors.primaryDark, backgroundColor: '#E8F3F0' },
  priority: { color: colors.primaryDark, fontSize: 10, fontWeight: '800', backgroundColor: '#E8F3F0', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 99 },
  cardTitle: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  meta: { color: colors.muted, fontSize: 14 },
  due: { color: colors.ink, fontSize: 13, marginTop: 3 },
  empty: { alignItems: 'center', padding: 28, gap: 8 },
  emptyTitle: { color: colors.ink, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  notice: { padding: 14, borderRadius: 12, backgroundColor: '#FDECEC', gap: 8, marginBottom: 12 },
  error: { color: colors.danger, lineHeight: 20 },
  retry: { color: colors.primary, fontWeight: '700' },
  loader: { marginTop: 40 },
});
