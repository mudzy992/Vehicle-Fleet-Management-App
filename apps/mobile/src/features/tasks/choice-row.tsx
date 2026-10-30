import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, radius, space } from '@/lib/theme';

export function ChoiceRow({ active, label, detail, onPress, selectionRole = 'radio', testID }: {
  active: boolean;
  label: string;
  detail?: string;
  selectionRole?: 'radio' | 'checkbox';
  testID?: string;
  onPress(): void;
}) {
  return (
    <Pressable testID={testID} accessibilityLabel={label} onPress={onPress} accessibilityRole={selectionRole} accessibilityState={{ selected: active }} style={[styles.choice, active && styles.active]}>
      <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  choice: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 11, padding: space[3], backgroundColor: colors.surface, gap: 4, justifyContent: 'center' },
  active: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  label: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  labelActive: { color: colors.ink },
  detail: { color: colors.muted, fontSize: 13, lineHeight: 20 },
});
