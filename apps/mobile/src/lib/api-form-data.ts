export function isFormDataBody(body: unknown): boolean {
  return typeof body === 'object' && body !== null && typeof (body as FormData).append === 'function';
}

export async function appendAttachmentFile(form: FormData, uri: string, fileName: string, mimeType: string): Promise<void> {
  form.append('file', { uri, name: fileName, type: mimeType } as unknown as Blob);
}
