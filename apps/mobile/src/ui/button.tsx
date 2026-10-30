import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { colors, controlMinHeight, radius, space, type } from '@/lib/theme';

interface Props {
  label: string;
  onPress(): void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  testID?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function AppButton({ label, onPress, disabled = false, loading = false, variant = 'primary', testID, accessibilityLabel, style }: Props) {
  const blocked = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: blocked }}
      onPress={onPress}
      disabled={blocked}
      style={({ pressed }) => [styles.base, disabled && !loading ? styles.blocked : styles[variant], pressed && !blocked && styles.pressed, style]}
    >
      {loading ? <ActivityIndicator color={variant === 'primary' ? colors.primaryFg : colors.primary} /> : (
        <Text style={[styles.label, disabled ? styles.labelBlocked : variant === 'primary' ? styles.labelPrimary : variant === 'danger' ? styles.labelDanger : styles.labelSecondary]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: controlMinHeight, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space[4] },
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  danger: { backgroundColor: colors.dangerSoft },
  pressed: { opacity: 0.84 },
  blocked: { backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border },
  label: { ...type.base, fontWeight: '700' },
  labelPrimary: { color: colors.primaryFg },
  labelSecondary: { color: colors.ink },
  labelDanger: { color: colors.danger },
  labelBlocked: { color: colors.muted },
});
