import { Text, View } from 'react-native';
import { AttachmentThumbs } from '@/features/tasks/attachment-thumbs';
import { PhotoActions } from '@/features/tasks/photo-actions';
import { colors, type } from '@/lib/theme';

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function PhotoField({
  widget,
  value,
  required,
  locked,
  uploading,
  canUpload,
  localUris,
  onCamera,
  onGallery,
  onDocument,
  onRemove,
}: {
  widget: 'PHOTO' | 'FILE';
  value: unknown;
  required: boolean;
  locked: boolean;
  uploading: boolean;
  canUpload: boolean;
  localUris?: Record<string, string>;
  onCamera(): void;
  onGallery(): void;
  onDocument(): void;
  onRemove?(id: string): void;
}) {
  const ids = stringArray(value);
  if (!canUpload) {
    return (
      <View>
        <AttachmentThumbs ids={ids} localUris={localUris} kind={widget} />
        <Text style={styles.help}>Za upload je potrebna dozvola attachment:upload.</Text>
      </View>
    );
  }
  return (
    <View style={styles.box}>
      <AttachmentThumbs ids={ids} localUris={localUris} kind={widget} onRemove={locked ? undefined : onRemove} />
      <PhotoActions
        widget={widget}
        locked={locked}
        uploading={uploading}
        count={ids.length}
        required={required}
        onCamera={onCamera}
        onGallery={onGallery}
        onDocument={onDocument}
      />
    </View>
  );
}

const styles = {
  box: { gap: 10 },
  help: { color: colors.muted, ...type.sm, lineHeight: 20 },
};
