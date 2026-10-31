import * as FileSystem from 'expo-file-system/legacy';
import { currentAccessToken, refreshSession, request, requestBinary } from '@/lib/api-client';
import { appendAttachmentFile } from '@/lib/api-form-data';
import { ApiError, type Envelope } from '@/lib/api-error';
import { toastHttpError } from '@/lib/toast';

const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? 'https://api.vehicle.ba101.top/api/v1').replace(/\/$/u, '');

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function isImageBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return true;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return true;
  return bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
}

function findBufferData(value: unknown): number[] | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { type?: string; data?: unknown; stream?: unknown };
  if (record.type === 'Buffer' && Array.isArray(record.data)) return record.data as number[];
  return findBufferData(record.data) ?? findBufferData(record.stream);
}

function bytesFromPayload(bytes: Uint8Array): Uint8Array {
  if (isImageBytes(bytes)) return bytes;
  if (bytes[0] !== 0x7b) throw new ApiError('Odgovor nije fotografija.', 400, 'HTTP_ERROR');
  try {
    const raw = findBufferData(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
    const recovered = raw ? Uint8Array.from(raw) : null;
    if (recovered && isImageBytes(recovered)) return recovered;
  } catch {
    // JSON envelope bez JPEG bafera — ista greška kao neispravan sadržaj.
  }
  throw new ApiError('Odgovor nije fotografija.', 400, 'HTTP_ERROR');
}

export async function cacheSignedPhoto(id: string): Promise<string> {
  const bytes = bytesFromPayload(new Uint8Array(await requestBinary(`/attachments/${encodeURIComponent(id)}/content`)));
  const base64 = bytesToBase64(bytes);
  const directory = FileSystem.cacheDirectory;
  if (!directory) return `data:image/jpeg;base64,${base64}`;
  const dest = `${directory}att-${id}.jpg`;
  await FileSystem.writeAsStringAsync(dest, base64, { encoding: FileSystem.EncodingType.Base64 });
  return dest;
}

function parseEnvelope<T>(raw: string, status: number, path: string): T {
  let body: Envelope<T> | null = null;
  try {
    body = JSON.parse(raw) as Envelope<T>;
  } catch {
    if (status >= 400) throw new ApiError(`Zahtjev nije uspio (HTTP ${status}).`, status, 'HTTP_ERROR');
  }
  if (status >= 400) {
    const error = body && 'error' in body ? body.error : {};
    const message = error.message ?? `Zahtjev nije uspio (HTTP ${status}).`;
    toastHttpError({ method: 'POST', path, status, message });
    throw new ApiError(message, status, error.code ?? 'HTTP_ERROR', error.requestId, error.details);
  }
  if (body && 'data' in body) return body.data;
  throw new ApiError('Odgovor servera nije valjan.', status, 'HTTP_ERROR');
}

async function nativeUpload<T>(path: string, file: { uri: string; name: string; mimeType: string }): Promise<T> {
  const token = currentAccessToken();
  const result = await FileSystem.uploadAsync(`${API_BASE}${path}`, file.uri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: 'file',
    mimeType: file.mimeType,
    headers: {
      Accept: 'application/json',
      'X-Client-Type': 'MOBILE_ANDROID',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  return parseEnvelope<T>(result.body, result.status, path);
}

export async function uploadMultipart<T>(path: string, file: { uri: string; name: string; mimeType: string }): Promise<T> {
  try {
    try {
      return await nativeUpload<T>(path, file);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401 && await refreshSession()) {
        return await nativeUpload<T>(path, file);
      }
      if (cause instanceof ApiError) throw cause;
    }
  } catch (cause) {
    if (cause instanceof ApiError) throw cause;
  }
  const form = new FormData();
  await appendAttachmentFile(form, file.uri, file.name, file.mimeType);
  return request<T>(path, { method: 'POST', body: form });
}
