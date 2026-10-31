import { StyleSheet } from 'react-native';
import { colors, type } from '@/lib/theme';

export const createTaskStyles = StyleSheet.create({
  flex: { flex: 1 },
  page: { padding: 18, gap: 14, paddingBottom: 140 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  muted: { color: colors.muted, ...type.sm, lineHeight: 19 },
  progress: { height: 6, backgroundColor: colors.surfaceMuted, borderRadius: 99, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 99 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 18, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  actions: { flexDirection: 'row', gap: 10 },
  footerBtn: { flex: 1 },
  error: { color: colors.danger, ...type.sm, lineHeight: 19 },
});
