import { type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors, space } from '@/lib/theme';

interface Props {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  edges?: readonly Edge[];
}

export function Screen({ children, style, padded = true, edges = ['left', 'right'] }: Props) {
  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      <View style={[styles.body, padded && styles.padded, style]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, backgroundColor: colors.background },
  padded: { paddingHorizontal: space[4], paddingTop: space[3] },
});
