import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '@/lib/theme';

export function ListCard({ children, accent }: { children: ReactNode; accent?: string }) {
  return (
    <View style={styles.card}>
      {accent ? <View style={[styles.accent, { backgroundColor: accent }]} /> : null}
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    overflow: 'hidden',
    backgroundColor: 'transparent',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  accent: { width: 3 },
  body: { flex: 1, padding: 14, gap: 5 },
});
