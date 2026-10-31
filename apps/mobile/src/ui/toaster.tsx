import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dismissToast, subscribeToasts, type ToastItem, type ToastKind } from '@/lib/toast';
import { colors, radius, space, type } from '@/lib/theme';

const KIND: Record<ToastKind, { border: string; background: string; text: string }> = {
  success: { border: colors.success, background: colors.successSoft, text: colors.success },
  danger: { border: colors.danger, background: colors.dangerSoft, text: colors.danger },
  warning: { border: colors.warning, background: colors.warningSoft, text: colors.warning },
  info: { border: colors.info, background: colors.infoSoft, text: colors.info },
};

export function Toaster() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setItems), []);
  if (items.length === 0) return null;
  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + 8 }]}>
      {items.map((item) => {
        const tone = KIND[item.kind];
        return (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={item.message}
            onPress={() => dismissToast(item.id)}
            style={[styles.toast, { borderColor: tone.border, backgroundColor: tone.background }]}
          >
            <Text style={[styles.text, { color: tone.text }]}>{item.message}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: space[4], right: space[4], zIndex: 50, gap: space[2] },
  toast: { borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: space[3], paddingVertical: space[3] },
  text: { ...type.sm, fontWeight: '700' },
});
