import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native';
import { OUTBOX_EVENT_TYPES } from '@vfm/shared';
import { mobileApi, toUserMessage, type NotificationPreferenceView } from '@/lib/api';
import { t } from '@/lib/i18n';
import { colors, radius, space, type } from '@/lib/theme';

const TYPE_LABELS: Record<string, string> = {
  TASK_CREATED: 'Novi zadatak',
  TASK_ASSIGNED: 'Promjena dodjele zadatka',
  TASK_CLAIMED: 'Zadatak preuzet',
  TASK_COMPLETED: 'Zadatak završen',
  TASK_RELEASED: 'Zadatak oslobođen',
  TASK_CANCELLED: 'Zadatak otkazan',
  TASK_REOPENED: 'Zadatak ponovo otvoren',
  TASK_DUE_SOON: 'Rok zadatka se približava',
  TASK_OVERDUE: 'Zadatak je prekoračio rok',
  REMINDER_DUE: 'Podsjetnik dospijeva',
  REGISTRATION_EXPIRING: 'Registracija ističe',
  INSURANCE_EXPIRING: 'Osiguranje ističe',
  SERVICE_DUE: 'Servis je dospio',
  DRIVER_LICENSE_EXPIRING: 'Dozvola vozača ističe',
  TIRE_SET_MOUNTED: 'Komplet guma montiran',
  TIRE_SET_DISMOUNTED: 'Komplet guma demontiran',
  TIRE_SET_SWAPPED: 'Kompleti guma zamijenjeni',
  REPORT_READY: 'Izvještaj je spreman',
  USER_PERMISSION_CHANGED: 'Prava pristupa su promijenjena',
};

function rowFor(type: string, rows: NotificationPreferenceView[]) {
  const found = rows.find((item) => item.type === type);
  return { type, channelInApp: found?.channelInApp ?? true, channelFcm: found?.channelFcm ?? true, channelEmail: false };
}

export function PreferencesCard() {
  const [rows, setRows] = useState<NotificationPreferenceView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const inputs = useMemo(() => OUTBOX_EVENT_TYPES.map((type) => rowFor(type, rows)), [rows]);

  useEffect(() => {
    let active = true;
    mobileApi.notificationPreferences().then((result) => {
      if (active) setRows(result.items);
    }).catch((cause: unknown) => {
      if (active) setError(toUserMessage(cause, 'Postavke nisu dostupne.'));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const save = async (type: string, channelInApp: boolean, channelFcm: boolean) => {
    setSaving(type);
    setError(null);
    try {
      const updated = await mobileApi.saveNotificationPreference({ type, channelInApp, channelFcm, channelEmail: false });
      setRows((current) => {
        const next = current.filter((item) => item.type !== type);
        next.push(updated);
        return next;
      });
    } catch (cause) {
      setError(toUserMessage(cause, 'Postavka nije sačuvana.'));
    } finally {
      setSaving(null);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('notificationPrefs')}</Text>
      <Text style={styles.hint}>{t('fcmOwnerNote')}</Text>
      <Text style={styles.hint}>{t('emailInactive')}</Text>
      {loading ? <ActivityIndicator color={colors.primary} /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {inputs.map((input) => (
        <View key={input.type} style={styles.row}>
          <Text style={styles.label}>{TYPE_LABELS[input.type] ?? input.type}</Text>
          <View style={styles.switches}>
            <Text style={styles.switchLabel}>In-app</Text>
            <Switch value={input.channelInApp} disabled={saving === input.type} onValueChange={(value) => void save(input.type, value, input.channelFcm)} trackColor={{ false: colors.surfaceMuted, true: colors.primary }} thumbColor={input.channelInApp ? colors.primaryFg : colors.ink} ios_backgroundColor={colors.surfaceMuted} />
            <Text style={styles.switchLabel}>Push</Text>
            <Switch value={input.channelFcm} disabled={saving === input.type} onValueChange={(value) => void save(input.type, input.channelInApp, value)} trackColor={{ false: colors.surfaceMuted, true: colors.primary }} thumbColor={input.channelFcm ? colors.primaryFg : colors.ink} ios_backgroundColor={colors.surfaceMuted} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: space[4], backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, gap: space[3] },
  title: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  hint: { color: colors.muted, ...type.sm, lineHeight: 20 },
  row: { gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space[3] },
  label: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  switches: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  switchLabel: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  error: { color: colors.danger, ...type.sm },
});
