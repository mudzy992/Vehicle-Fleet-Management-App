import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { useAuth } from '@/features/auth/auth-provider';
import { isOfflineError, mobileApi, toUserMessage, type VehicleSummary } from '@/lib/api';
import { displayOdometer } from '@/lib/format';
import { t } from '@/lib/i18n';
import { colors, radius, space, type } from '@/lib/theme';
import { DuePill } from '@/ui/due-pill';
import { EmptyState } from '@/ui/empty-state';
import { ErrorBanner } from '@/ui/error-banner';
import { Screen } from '@/ui/screen';
import { SkeletonList } from '@/ui/skeleton';
import { StatusBadge } from '@/ui/status-badge';

export default function VehiclesScreen() {
  const { user } = useAuth();
  const canView = user?.permissions.includes('vehicle:view') === true;
  const [items, setItems] = useState<VehicleSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (pull = false) => {
    if (!canView) return;
    setError(null);
    if (pull) setRefreshing(true);
    else setLoading(true);
    try {
      const result = await mobileApi.vehicles();
      setItems(result.items);
      setTotal(result.total);
    } catch (cause) {
      setError(isOfflineError(cause) ? t('offlineBanner') : toUserMessage(cause, 'Vozila se nisu mogla učitati.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [canView]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (!canView) {
    return <Screen><ErrorBanner message={t('noPermission')} /></Screen>;
  }

  return (
    <Screen>
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {loading ? <SkeletonList /> : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />}
          contentContainerStyle={items.length ? styles.list : styles.emptyList}
          ListEmptyComponent={<EmptyState title="Nema vozila za prikaz" hint="Povucite ekran prema dolje da provjerite ponovo." />}
          ListFooterComponent={total > items.length ? <Text style={styles.more}>{t('loadMoreHint')}</Text> : null}
          renderItem={({ item }) => (
            <Link href={{ pathname: '/vehicle/[id]', params: { id: item.id } }} asChild>
              <Pressable style={({ pressed }) => [styles.card, pressed && styles.pressed]} accessibilityRole="button">
                <View style={styles.cardTop}>
                  <Text style={styles.internalNo}>{item.internalNo}</Text>
                  <StatusBadge value={item.status} domain="vehicle" />
                </View>
                <Text style={styles.vehicleName}>{item.make} {item.model}{item.year ? ` · ${item.year}` : ''}</Text>
                <Text style={styles.meta}>{item.plateNumber ?? 'Bez registarske oznake'}</Text>
                <Text style={styles.odometer}>{displayOdometer(item.odometerKm)}</Text>
                <DuePill label="Registracija" value={item.registrationExpiresAt} />
              </Pressable>
            </Link>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: space[3], paddingBottom: space[5] },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  card: { padding: space[4], borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 7 },
  pressed: { opacity: 0.8 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  internalNo: { color: colors.primary, fontWeight: '800', fontSize: 13 },
  vehicleName: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  meta: { color: colors.muted, fontSize: 14 },
  odometer: { color: colors.ink, fontSize: 13, fontWeight: '700', marginTop: 3 },
  more: { color: colors.muted, ...type.sm, textAlign: 'center', paddingVertical: space[3] },
});
