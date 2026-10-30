export function isFormDataBody(body: unknown): boolean {
  return typeof body === 'object' && body !== null && typeof (body as FormData).append === 'function';
}

export async function appendAttachmentFile(form: FormData, uri: string, fileName: string, mimeType: string): Promise<void> {
  try {
    const response = await fetch(uri);
    const blob = await response.blob();
    if (blob.size > 0) {
      form.append('file', blob, fileName);
      return;
    }
  } catch {
    // content:// URI na Androidu ponekad ne ide kroz fetch; RN FormData prima uri dio.
  }
  form.append('file', { uri, name: fileName, type: mimeType } as unknown as Blob);
}
