export function isFormDataBody(body: unknown): boolean {
  return typeof body === 'object' && body !== null && typeof (body as FormData).append === 'function';
}

async function readUriAsBlob(uri: string, mimeType: string): Promise<Blob | null> {
  try {
    const response = await fetch(uri);
    const blob = await response.blob();
    if (blob.size === 0) return null;
    if (blob.type === mimeType) return blob;
    return new Blob([await blob.arrayBuffer()], { type: mimeType });
  } catch {
    return null;
  }
}

export async function appendAttachmentFile(form: FormData, uri: string, fileName: string, mimeType: string): Promise<void> {
  const blob = await readUriAsBlob(uri, mimeType);
  if (blob) {
    form.append('file', blob, fileName);
    return;
  }
  form.append('file', { uri, name: fileName, type: mimeType } as unknown as Blob);
}
