import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { mobileApi, toUserMessage, type VehicleSummary } from '@/lib/api';
import { colors } from '@/lib/theme';

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'U upotrebi',
  IN_SERVICE: 'Na servisu',
  INACTIVE: 'Neaktivno',
  DAMAGED: 'Oštećeno',
  ARCHIVED: 'Arhivirano',
};

const FUEL_LABELS: Record<string, string> = {
  DIESEL: 'Dizel',
  PETROL: 'Benzin',
  LPG: 'Plin',
  CNG: 'CNG',
  HYBRID: 'Hibrid',
  ELECTRIC: 'Električno',
};

export default function VehiclesScreen() {
  const [items, setItems] = useState<VehicleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (pull = false) => {
    setError(null);
    if (pull) setRefreshing(true);
    else setLoading(true);
    try {
      const result = await mobileApi.vehicles();
      setItems(result.items);
    } catch (cause) {
      setError(toUserMessage(cause, 'Vozila se nisu mogla učitati.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <View style={styles.page}>
      <View style={styles.heading}>
        <View>
          <Text style={styles.title}>Vozila</Text>
          <Text style={styles.subtitle}>Pregled vozila i osnovnih podataka.</Text>
        </View>
        <Pressable onPress={() => void load(true)} accessibilityRole="button" accessibilityLabel="Osvježi vozila" style={styles.refresh}>
          <Text style={styles.refreshText}>↻</Text>
        </Pressable>
      </View>
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
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyTitle}>Nema vozila za prikaz</Text><Text style={styles.subtitle}>Povucite ekran prema dolje da provjerite ponovo.</Text></View>}
          renderItem={({ item }) => (
            <Link href={{ pathname: '/vehicle/[id]', params: { id: item.id } }} asChild>
              <Pressable style={({ pressed }) => [styles.card, pressed && styles.pressed]} accessibilityRole="button">
                <View style={styles.cardTop}>
                  <Text style={styles.internalNo}>{item.internalNo}</Text>
                  <Text style={[styles.status, item.status === 'ACTIVE' && styles.statusActive]}>{STATUS_LABELS[item.status] ?? item.status}</Text>
                </View>
                <Text style={styles.vehicleName}>{item.make} {item.model}{item.year ? ` · ${item.year}` : ''}</Text>
                <Text style={styles.meta}>{item.plateNumber ?? 'Bez registarske oznake'} · {FUEL_LABELS[item.fuelType] ?? item.fuelType}</Text>
                <Text style={styles.odometer}>{item.odometerKm.toLocaleString('bs-BA')} km</Text>
              </Pressable>
            </Link>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 18, paddingTop: 14 },
  heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  subtitle: { color: colors.muted, fontSize: 14, marginTop: 4 },
  refresh: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  refreshText: { color: colors.primary, fontSize: 27 },
  list: { gap: 12, paddingBottom: 20 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  card: { padding: 16, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 7 },
  pressed: { opacity: 0.8 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  internalNo: { color: colors.primary, fontWeight: '800', fontSize: 13 },
  status: { color: colors.muted, fontSize: 11, fontWeight: '800', backgroundColor: colors.neutralSoft, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 99 },
  statusActive: { color: colors.primary, backgroundColor: colors.primarySoft },
  vehicleName: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  meta: { color: colors.muted, fontSize: 14 },
  odometer: { color: colors.ink, fontSize: 13, fontWeight: '700', marginTop: 3 },
  empty: { alignItems: 'center', padding: 28, gap: 8 },
  emptyTitle: { color: colors.ink, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  notice: { padding: 14, borderRadius: 12, backgroundColor: colors.dangerSoft, gap: 8, marginBottom: 12 },
  error: { color: colors.danger, lineHeight: 20 },
  retry: { color: colors.primary, fontWeight: '700' },
  loader: { marginTop: 40 },
});
