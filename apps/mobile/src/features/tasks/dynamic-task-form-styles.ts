import { StyleSheet } from 'react-native';
import { colors, radius, space, stickyCtaHeight, type } from '@/lib/theme';

export const dynamicTaskFormStyles = StyleSheet.create({
  wrap: { gap: space[3] },
  formTitle: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  muted: { color: colors.muted, ...type.sm, lineHeight: 20 },
  section: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: space[3], gap: space[3] },
  sectionTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  textarea: { minHeight: 90, textAlignVertical: 'top' },
  submit: { minHeight: stickyCtaHeight, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderRadius: radius.lg, marginBottom: 10 },
  submitText: { color: colors.primaryFg, fontSize: 16, fontWeight: '800' },
  pressed: { opacity: 0.82 },
  disabled: { backgroundColor: colors.surfaceMuted },
  submitMuted: { color: colors.muted },
  error: { color: colors.danger, ...type.sm, lineHeight: 19 },
  state: { padding: 18, gap: 10, alignItems: 'center' },
});
