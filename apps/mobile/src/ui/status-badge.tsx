import { StyleSheet, Text, View } from 'react-native';
import { statusLabel, statusLevel, type LabelDomain } from '@vfm/shared';
import { colors, radius, space, type } from '@/lib/theme';

const TONE: Record<string, { color: string; background: string }> = {
  success: { color: colors.success, background: colors.successSoft },
  info: { color: colors.info, background: colors.infoSoft },
  warning: { color: colors.warning, background: colors.warningSoft },
  danger: { color: colors.danger, background: colors.dangerSoft },
  neutral: { color: colors.ink, background: colors.neutralSoft },
  default: { color: colors.ink, background: colors.neutralSoft },
};

export function StatusBadge({ value, domain }: { value: string; domain?: LabelDomain }) {
  const level = statusLevel(value, domain);
  const tone = TONE[level] ?? TONE.default;
  return (
    <View style={[styles.badge, { backgroundColor: tone.background }]}>
      <Text style={[styles.text, { color: tone.color }]}>{statusLabel(value, domain)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { paddingHorizontal: space[2], paddingVertical: 5, borderRadius: radius.pill, overflow: 'hidden' },
  text: { ...type.xs, fontWeight: '800' },
});
