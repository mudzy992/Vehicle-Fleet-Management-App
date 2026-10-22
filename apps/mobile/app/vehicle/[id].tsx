import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { mobileApi, toUserMessage, type VehicleDetail } from '@/lib/api';
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

function dateLabel(value: string | null): string {
  if (!value) return 'Nije uneseno';
  const date = value.length === 10 ? new Date(`${value}T00:00:00Z`) : new Date(value);
  return new Intl.DateTimeFormat('bs-BA', {
    dateStyle: 'medium',
    ...(value.length > 10 ? { timeStyle: 'short' as const } : {}),
    timeZone: value.length === 10 ? 'UTC' : 'Europe/Sarajevo',
  }).format(date);
}

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
  if (!vehicle) return (
    <View style={styles.center}>
      <Text accessibilityRole="alert" style={styles.error}>{error ?? 'Vozilo nije pronađeno.'}</Text>
      <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>Pokušaj ponovo</Text></Pressable>
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Stack.Screen options={{ title: vehicle.internalNo }} />
      <View style={styles.hero}>
        <Text style={styles.internalNo}>{vehicle.internalNo}</Text>
        <Text style={styles.title}>{vehicle.make} {vehicle.model}{vehicle.year ? ` · ${vehicle.year}` : ''}</Text>
        <Text style={styles.plate}>{vehicle.plateNumber ?? 'Bez registarske oznake'}</Text>
        <Text style={[styles.status, vehicle.status === 'ACTIVE' && styles.statusActive]}>{STATUS_LABELS[vehicle.status] ?? vehicle.status}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Osnovni podaci</Text>
        <Info label="Kilometraža" value={`${vehicle.odometerKm.toLocaleString('bs-BA')} km`} />
        <Info label="Gorivo" value={FUEL_LABELS[vehicle.fuelType] ?? vehicle.fuelType} />
        <Info label="Mjenjač" value={vehicle.transmission ?? 'Nije uneseno'} />
        <Info label="Boja" value={vehicle.color ?? 'Nije uneseno'} />
        <Info label="Karoserija" value={vehicle.bodyType ?? 'Nije uneseno'} />
        <Info label="Zapremina motora" value={vehicle.engineCcm ? `${vehicle.engineCcm.toLocaleString('bs-BA')} cm³` : 'Nije uneseno'} />
        <Info label="Snaga motora" value={vehicle.enginePowerKw ? `${vehicle.enginePowerKw} kW` : 'Nije uneseno'} />
        <Info label="Broj sjedišta" value={vehicle.seats ? String(vehicle.seats) : 'Nije uneseno'} />
        <Info label="Način vlasništva" value={vehicle.ownershipType} />
        <Info label="VIN" value={vehicle.vin ?? 'Nije uneseno'} />
        <Info label="Centar troška" value={vehicle.costCenter ?? 'Nije uneseno'} />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Rokovi</Text>
        <Info label="Registracija važi do" value={dateLabel(vehicle.registrationExpiresAt)} />
        <Info label="Osiguranje važi do" value={dateLabel(vehicle.insuranceExpiresAt)} />
        <Info label="Sljedeći servis" value={dateLabel(vehicle.nextServiceDueDate)} />
        <Info label="Servis na kilometraži" value={vehicle.nextServiceDueKm ? `${vehicle.nextServiceDueKm.toLocaleString('bs-BA')} km` : 'Nije uneseno'} />
      </View>

      {vehicle.notes ? <View style={styles.card}><Text style={styles.sectionTitle}>Napomene</Text><Text style={styles.notes}>{vehicle.notes}</Text></View> : null}
    </ScrollView>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <View style={styles.info}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  page: { padding: 18, gap: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  hero: { backgroundColor: colors.surface, borderRadius: 18, borderColor: colors.border, borderWidth: 1, padding: 18, gap: 8 },
  internalNo: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  title: { color: colors.ink, fontSize: 23, fontWeight: '800' },
  plate: { color: colors.muted, fontSize: 15 },
  status: { alignSelf: 'flex-start', color: colors.muted, fontSize: 12, fontWeight: '800', backgroundColor: '#EFF2F5', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 99, overflow: 'hidden' },
  statusActive: { color: colors.primaryDark, backgroundColor: '#E8F3F0' },
  card: { backgroundColor: colors.surface, borderRadius: 16, borderColor: colors.border, borderWidth: 1, padding: 16, gap: 13 },
  sectionTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  info: { gap: 3 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  value: { color: colors.ink, fontSize: 15, fontWeight: '600' },
  notes: { color: colors.ink, fontSize: 14, lineHeight: 21 },
  error: { color: colors.danger, textAlign: 'center', lineHeight: 21 },
  retry: { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 11 },
  retryText: { color: '#fff', fontWeight: '700' },
});
