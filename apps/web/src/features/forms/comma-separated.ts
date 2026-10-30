const MIME_ALIASES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  bmp: 'image/bmp',
  'image/jpg': 'image/jpeg',
};

export function parseCommaSeparated(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseMimeTypes(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of parseCommaSeparated(raw)) {
    const token = item.toLowerCase().replace(/^\./u, '');
    const mime = token.includes('/') ? (MIME_ALIASES[token] ?? token) : (MIME_ALIASES[token] ?? item);
    if (seen.has(mime)) continue;
    seen.add(mime);
    result.push(mime);
  }
  return result;
}
