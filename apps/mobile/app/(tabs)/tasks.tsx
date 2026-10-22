import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { ApiError, mobileApi, type TaskSummary } from '@/lib/api';
import { colors } from '@/lib/theme';

function dateLabel(value: string | null): string {
  if (!value) return 'Bez roka';
  return new Intl.DateTimeFormat('bs-BA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Sarajevo' }).format(new Date(value));
}

export default function TasksScreen() {
  const [items, setItems] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (pull = false) => {
    setError(null);
    if (pull) setRefreshing(true); else setLoading(true);
    try {
      const result = await mobileApi.tasks();
      setItems(result.items);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Zadaci se nisu mogli učitati.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <View style={styles.page}>
      <View style={styles.heading}><View><Text style={styles.title}>Slobodni zadaci</Text><Text style={styles.subtitle}>Preuzmite zadatak koji možete izvršiti.</Text></View><Pressable onPress={() => void load(true)} accessibilityRole="button" accessibilityLabel="Osvježi zadatke" style={styles.refresh}><Text style={styles.refreshText}>↻</Text></Pressable></View>
      {error ? <View style={styles.notice}><Text style={styles.error}>{error}</Text><Pressable onPress={() => void load()}><Text style={styles.retry}>Pokušaj ponovo</Text></Pressable></View> : null}
      {loading ? <ActivityIndicator color={colors.primary} size="large" style={styles.loader} /> : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />}
          contentContainerStyle={items.length ? styles.list : styles.emptyList}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyTitle}>Nema slobodnih zadataka</Text><Text style={styles.subtitle}>Povucite ekran prema dolje da provjerite ponovo.</Text></View>}
          renderItem={({ item }) => (
            <Link href={{ pathname: '/task/[id]', params: { id: item.id } }} asChild>
              <Pressable style={({ pressed }) => [styles.card, pressed && styles.pressed]} accessibilityRole="button">
                <View style={styles.cardTop}><Text style={styles.code}>{item.code}</Text><Text style={styles.priority}>{item.priority === 'URGENT' ? 'HITNO' : item.priority === 'HIGH' ? 'VISOK' : item.priority === 'LOW' ? 'NIZAK' : 'NORMALAN'}</Text></View>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.meta}>{item.taskTypeName}{item.vehicleInternalNo ? ` · ${item.vehicleInternalNo}` : ''}</Text>
                <Text style={styles.due}>Rok: {dateLabel(item.dueAt)}</Text>
              </Pressable>
            </Link>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 18, paddingTop: 14 }, heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }, title: { color: colors.ink, fontSize: 22, fontWeight: '800' }, subtitle: { color: colors.muted, fontSize: 14, marginTop: 4 }, refresh: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }, refreshText: { color: colors.primary, fontSize: 27 }, list: { gap: 12, paddingBottom: 20 }, emptyList: { flexGrow: 1, justifyContent: 'center' }, card: { padding: 16, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 7 }, pressed: { opacity: 0.8 }, cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, code: { color: colors.muted, fontWeight: '700', fontSize: 12 }, priority: { color: colors.primaryDark, fontSize: 11, fontWeight: '800', backgroundColor: '#E8F3F0', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 99 }, cardTitle: { color: colors.ink, fontSize: 17, fontWeight: '700' }, meta: { color: colors.muted, fontSize: 14 }, due: { color: colors.ink, fontSize: 13, marginTop: 3 }, empty: { alignItems: 'center', padding: 28, gap: 8 }, emptyTitle: { color: colors.ink, fontSize: 18, fontWeight: '700', textAlign: 'center' }, notice: { padding: 14, borderRadius: 12, backgroundColor: '#FDECEC', gap: 8, marginBottom: 12 }, error: { color: colors.danger, lineHeight: 20 }, retry: { color: colors.primary, fontWeight: '700' }, loader: { marginTop: 40 },
});
