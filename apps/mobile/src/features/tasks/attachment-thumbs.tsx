import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { cacheSignedPhoto } from '@/lib/api-upload';
import { colors, radius, space, type } from '@/lib/theme';

export function AttachmentThumbs({
  ids,
  localUris = {},
  kind,
  onRemove,
}: {
  ids: string[];
  localUris?: Record<string, string>;
  kind: 'PHOTO' | 'FILE';
  onRemove?(id: string): void;
}) {
  const [remote, setRemote] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const missing = ids.filter((id) => !localUris[id] && remote[id] === undefined);
    if (missing.length === 0) return undefined;
    void Promise.all(missing.map(async (id) => {
      try {
        if (kind !== 'PHOTO') {
          if (active) setRemote((current) => ({ ...current, [id]: '' }));
          return;
        }
        const uri = await cacheSignedPhoto(id);
        if (active) setRemote((current) => ({ ...current, [id]: uri }));
      } catch {
        if (active) setRemote((current) => ({ ...current, [id]: '' }));
      }
    }));
    return () => { active = false; };
  }, [ids, kind, localUris]);
  if (ids.length === 0) return null;
  return (
    <View style={styles.row}>
      {ids.map((id) => {
        const uri = localUris[id] ?? remote[id];
        return (
          <View key={id} style={styles.item}>
            {kind === 'PHOTO' && uri ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Otvori fotografiju" onPress={() => setPreview(uri)}>
                <Image
                  accessibilityLabel="Priložena fotografija"
                  source={{ uri }}
                  style={styles.image}
                  resizeMode="cover"
                  onError={() => {
                    if (localUris[id]) return;
                    setRemote((current) => ({ ...current, [id]: '' }));
                  }}
                />
              </Pressable>
            ) : (
              <View style={styles.file}>
                {kind === 'PHOTO' && uri === undefined ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <Text style={styles.fileText} numberOfLines={2}>{kind === 'FILE' ? 'Datoteka' : 'Slika se nije učitala'}</Text>
                )}
              </View>
            )}
            {onRemove ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Ukloni prilog" onPress={() => onRemove(id)} style={styles.remove}>
                <Text style={styles.removeText}>Ukloni</Text>
              </Pressable>
            ) : kind === 'PHOTO' && uri ? (
              <Text style={styles.openText}>Otvori</Text>
            ) : null}
          </View>
        );
      })}
      <Modal visible={preview !== null} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Zatvori fotografiju" onPress={() => setPreview(null)} style={styles.preview}>
          {preview ? <Image accessibilityLabel="Fotografija u punoj veličini" source={{ uri: preview }} style={styles.previewImage} resizeMode="contain" /> : null}
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  item: { width: 96, gap: 6 },
  image: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  file: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center', padding: 8 },
  fileText: { color: colors.ink, ...type.xs, textAlign: 'center' },
  remove: { minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  removeText: { color: colors.danger, fontSize: 12, fontWeight: '700' },
  openText: { color: colors.primary, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  preview: { flex: 1, backgroundColor: colors.shadow, alignItems: 'center', justifyContent: 'center', padding: space[4] },
  previewImage: { width: '100%', height: '100%' },
});
