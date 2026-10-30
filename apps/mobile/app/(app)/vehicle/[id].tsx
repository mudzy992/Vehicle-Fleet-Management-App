import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { statusLabel } from '@vfm/shared';
import { mobileApi, toUserMessage, type VehicleDetail } from '@/lib/api';
import { displayDate, displayOdometer } from '@/lib/format';
import { colors, space } from '@/lib/theme';
import { Card } from '@/ui/card';
import { DuePill } from '@/ui/due-pill';
import { ErrorBanner } from '@/ui/error-banner';
import { StatusBadge } from '@/ui/status-badge';

export default function VehicleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [vehicle, setVehicle] = useState<VehicleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setVehicle(await mobileApi.vehicle(id));
    } catch (cause) {
      setError(toUserMessage(cause, 'Podaci o vozilu se nisu mogli učitati.'));
      setVehicle(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>;
  if (!vehicle) return <View style={styles.center}><ErrorBanner message={error ?? 'Vozilo nije pronađeno.'} onRetry={() => void load()} /></View>;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Stack.Screen options={{ title: vehicle.internalNo }} />
      <Card>
        <Text style={styles.internalNo}>{vehicle.internalNo}</Text>
        <Text style={styles.title}>{vehicle.make} {vehicle.model}{vehicle.year ? ` · ${vehicle.year}` : ''}</Text>
        <Text style={styles.plate}>{vehicle.plateNumber ?? 'Bez registarske oznake'}</Text>
        <StatusBadge value={vehicle.status} domain="vehicle" />
      </Card>
      <Card>
        <Text style={styles.sectionTitle}>Osnovni podaci</Text>
        <Info label="Kilometraža" value={displayOdometer(vehicle.odometerKm)} />
        <Info label="Gorivo" value={statusLabel(vehicle.fuelType, 'fuelType')} />
        <Info label="Mjenjač" value={vehicle.transmission ?? 'Nije uneseno'} />
        <Info label="Boja" value={vehicle.color ?? 'Nije uneseno'} />
        <Info label="VIN" value={vehicle.vin ?? 'Nije uneseno'} />
        <Info label="Način vlasništva" value={statusLabel(vehicle.ownershipType, 'ownershipType')} />
      </Card>
      <Card>
        <Text style={styles.sectionTitle}>Rokovi</Text>
        <DuePill label="Registracija" value={vehicle.registrationExpiresAt} />
        <DuePill label="Osiguranje" value={vehicle.insuranceExpiresAt} />
        <DuePill label="Sljedeći servis" value={vehicle.nextServiceDueDate} />
        <Info label="Servis na kilometraži" value={vehicle.nextServiceDueKm ? displayOdometer(vehicle.nextServiceDueKm) : 'Nije uneseno'} />
        <Info label="Registracija važi do" value={displayDate(vehicle.registrationExpiresAt) ?? 'Nije uneseno'} />
      </Card>
      {vehicle.notes ? <Card><Text style={styles.sectionTitle}>Napomene</Text><Text style={styles.notes}>{vehicle.notes}</Text></Card> : null}
    </ScrollView>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <View style={styles.info}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  page: { padding: space[4], gap: space[3] },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  internalNo: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  title: { color: colors.ink, fontSize: 23, fontWeight: '800' },
  plate: { color: colors.ink, fontSize: 15 },
  sectionTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  info: { gap: 3 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  value: { color: colors.ink, fontSize: 15, fontWeight: '600' },
  notes: { color: colors.ink, fontSize: 14, lineHeight: 21 },
});
