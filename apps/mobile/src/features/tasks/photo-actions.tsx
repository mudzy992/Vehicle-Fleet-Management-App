import { StyleSheet, Text, View } from 'react-native';
import { colors, space, type } from '@/lib/theme';
import { AppButton } from '@/ui/button';

export function PhotoActions({
  widget,
  locked,
  uploading,
  count,
  required,
  onCamera,
  onGallery,
  onDocument,
}: {
  widget: 'PHOTO' | 'FILE';
  locked: boolean;
  uploading: boolean;
  count: number;
  required: boolean;
  onCamera(): void;
  onGallery(): void;
  onDocument(): void;
}) {
  const blocked = locked || uploading;
  return (
    <View style={styles.box}>
      <Text style={count > 0 ? styles.count : styles.help}>
        {uploading ? 'Upload u toku…' : `Dodano fajlova: ${count}`}
        {required ? ' · obavezno' : ''}
      </Text>
      {widget === 'PHOTO' ? (
        <>
          <AppButton testID="task-form-camera" label="Otvori kameru" variant="secondary" disabled={blocked} onPress={onCamera} />
          <AppButton testID="task-form-gallery" label="Iz galerije" variant="secondary" disabled={blocked} onPress={onGallery} />
        </>
      ) : (
        <AppButton testID="task-form-file" label="Odaberi fajl" variant="secondary" disabled={blocked} onPress={onDocument} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: space[2] },
  count: { color: colors.ink, ...type.sm, fontWeight: '700' },
  help: { color: colors.muted, ...type.sm, lineHeight: 20 },
});
