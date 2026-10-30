import { StyleSheet, Text, View } from 'react-native';
import { t } from '@/lib/i18n';
import { dueMeta } from '@/lib/format';
import { colors, radius, space, type } from '@/lib/theme';

const TONE: Record<string, { color: string; background: string }> = {
  success: { color: colors.success, background: colors.successSoft },
  info: { color: colors.info, background: colors.infoSoft },
  warning: { color: colors.warning, background: colors.warningSoft },
  danger: { color: colors.danger, background: colors.dangerSoft },
  neutral: { color: colors.ink, background: colors.neutralSoft },
};

export function DuePill({ value, label }: { value: string | null; label: string }) {
  const meta = dueMeta(value);
  const tone = meta ? TONE[meta.level] ?? TONE.neutral : TONE.neutral;
  return (
    <View style={styles.row}>
      <Text style={styles.caption}>{label}</Text>
      <View style={[styles.pill, { backgroundColor: tone.background }]}>
        <Text style={[styles.text, { color: tone.color }]}>{meta?.label ?? t('noDeadline')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: space[1] },
  caption: { color: colors.muted, ...type.xs, fontWeight: '600' },
  pill: { alignSelf: 'flex-start', paddingHorizontal: space[2], paddingVertical: 5, borderRadius: radius.pill },
  text: { ...type.xs, fontWeight: '800' },
});
