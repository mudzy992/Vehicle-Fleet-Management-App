import { StyleSheet, View } from 'react-native';
import { colors, radius, space } from '@/lib/theme';

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: rows }, (_, index) => <View key={index} style={styles.row} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space[3], paddingTop: space[2] },
  row: { height: 88, borderRadius: radius.xl, backgroundColor: colors.surfaceMuted },
});
