import { StyleSheet, Text, View } from 'react-native';
import { colors, space, type } from '@/lib/theme';

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.box}>
      <Text style={styles.title}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', padding: space[8], gap: space[2] },
  title: { color: colors.ink, ...type.lg, fontWeight: '700', textAlign: 'center' },
  hint: { color: colors.muted, ...type.sm, lineHeight: 20, textAlign: 'center' },
});
