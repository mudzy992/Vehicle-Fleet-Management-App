import * as DocumentPicker from 'expo-document-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import type { RenderField } from '@vfm/form-renderer/render-model';
import { mobileApi } from '@/lib/api';

export interface PickedFile { uri: string; name: string; mimeType: string }

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function jpegTarget(field: RenderField): { mimeType: string; format: ImageManipulator.SaveFormat; extension: string } {
  const configured = field.validation['mimeTypes'];
  const allowed = Array.isArray(configured) ? configured.filter((item): item is string => typeof item === 'string') : [];
  if (allowed.length === 0 || allowed.includes('image/jpeg')) {
    return { mimeType: 'image/jpeg', format: ImageManipulator.SaveFormat.JPEG, extension: 'jpg' };
  }
  if (allowed.includes('image/png')) {
    return { mimeType: 'image/png', format: ImageManipulator.SaveFormat.PNG, extension: 'png' };
  }
  return { mimeType: 'image/jpeg', format: ImageManipulator.SaveFormat.JPEG, extension: 'jpg' };
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

async function normalizePickedImage(asset: ImagePicker.ImagePickerAsset, field: RenderField, index: number): Promise<PickedFile> {
  const target = jpegTarget(field);
  const name = `prilog-${Date.now()}-${index + 1}.${target.extension}`;
  try {
    const image = await ImageManipulator.manipulateAsync(
      asset.uri,
      asset.width > 1600 ? [{ resize: { width: 1600 } }] : [],
      { compress: 0.78, format: target.format },
    );
    return { uri: image.uri, name, mimeType: target.mimeType };
  } catch {
    return { uri: asset.uri, name, mimeType: asset.mimeType ?? target.mimeType };
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

export async function pickPhoto(field: RenderField, source: 'CAMERA' | 'GALLERY'): Promise<PickedFile[]> {
  await ensurePhotoPermission(source);
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.82, allowsEditing: false, exif: false };
  const result = source === 'CAMERA'
    ? await ImagePicker.launchCameraAsync(options)
    : await ImagePicker.launchImageLibraryAsync({ ...options, allowsMultipleSelection: true });
  if (result.canceled) return [];
  return Promise.all(result.assets.map((asset, index) => normalizePickedImage(asset, field, index)));
}

export async function pickDocument(field: RenderField): Promise<PickedFile[]> {
  const configured = field.validation['mimeTypes'];
  const result = await DocumentPicker.getDocumentAsync({
    type: Array.isArray(configured) && configured.every((item) => typeof item === 'string') ? configured as string[] : '*/*',
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return [];
  return result.assets.map((asset) => ({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? 'application/octet-stream' }));
}
