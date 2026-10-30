import { Pressable, StyleSheet, Text, View } from 'react-native';
import { t } from '@/lib/i18n';
import { colors, radius, space, type } from '@/lib/theme';

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.box}>
      <Text accessibilityRole="alert" style={styles.text}>{message}</Text>
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}>
          <Text style={styles.retryText}>{t('retry')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { padding: space[3], borderRadius: radius.lg, backgroundColor: colors.dangerSoft, gap: space[2], marginBottom: space[3] },
  text: { color: colors.danger, ...type.sm, lineHeight: 20 },
  retry: { minHeight: 48, justifyContent: 'center' },
  retryText: { color: colors.primary, fontWeight: '700', fontSize: 16 },
});
