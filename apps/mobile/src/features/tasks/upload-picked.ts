import * as DocumentPicker from 'expo-document-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { FILE_MIME_TYPES } from '@vfm/shared';
import type { RenderField } from '@vfm/form-renderer/render-model';
import { mobileApi } from '@/lib/api';

export interface PickedFile { uri: string; name: string; mimeType: string }

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

async function ensurePhotoPermission(source: 'CAMERA' | 'GALLERY'): Promise<void> {
  if (source === 'CAMERA') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error('Dozvolite pristup kameri da biste fotografisali prilog.');
    return;
  }
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('Dozvolite pristup fotografijama da biste dodali prilog iz galerije.');
}

async function normalizePickedImage(asset: ImagePicker.ImagePickerAsset, index: number): Promise<PickedFile> {
  const name = `prilog-${Date.now()}-${index + 1}.jpg`;
  try {
    const image = await ImageManipulator.manipulateAsync(
      asset.uri,
      asset.width > 1600 ? [{ resize: { width: 1600 } }] : [],
      { compress: 0.78, format: ImageManipulator.SaveFormat.JPEG },
    );
    return { uri: image.uri, name, mimeType: 'image/jpeg' };
  } catch {
    throw new Error('Fotografiju nije moguće pretvoriti u JPEG. Odaberite JPG, PNG, WebP ili AVIF.');
  }
}

export async function uploadFiles(input: {
  field: RenderField;
  files: PickedFile[];
  existing: unknown;
  canUpload: boolean;
  onValues(ids: string[]): void;
  onError(message: string): void;
}): Promise<void> {
  if (!input.canUpload) {
    input.onError('Za dodavanje fotografija i priloga potrebna je dozvola za upload.');
    return;
  }
  const existing = strings(input.existing);
  const maxFiles = typeof input.field.validation['maxFiles'] === 'number' ? input.field.validation['maxFiles'] : undefined;
  if (maxFiles !== undefined && input.files.length > Math.max(0, maxFiles - existing.length)) {
    input.onError(`Polje „${input.field.label}” prima najviše ${maxFiles} fajlova.`);
    return;
  }
  if (input.files.length === 0) return;
  const ids = [...existing];
  for (const file of input.files) {
    const result = await mobileApi.uploadAttachment(file.uri, file.name, file.mimeType);
    ids.push(result.id);
    input.onValues([...ids]);
  }
}

export async function pickPhoto(_field: RenderField, source: 'CAMERA' | 'GALLERY'): Promise<PickedFile[]> {
  await ensurePhotoPermission(source);
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.82, allowsEditing: false, exif: false };
  const result = source === 'CAMERA'
    ? await ImagePicker.launchCameraAsync(options)
    : await ImagePicker.launchImageLibraryAsync({ ...options, allowsMultipleSelection: true });
  if (result.canceled) return [];
  return Promise.all(result.assets.map((asset, index) => normalizePickedImage(asset, index)));
}

export async function pickDocument(_field: RenderField): Promise<PickedFile[]> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [...FILE_MIME_TYPES],
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return [];
  return result.assets.map((asset) => ({
    uri: asset.uri,
    name: asset.name,
    mimeType: asset.mimeType ?? 'application/octet-stream',
  }));
}
