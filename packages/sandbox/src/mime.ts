const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  gif: 'image/gif',
  csv: 'text/csv',
  json: 'application/json',
  txt: 'text/plain',
  html: 'text/html',
  pdf: 'application/pdf',
};

export function getMimeType(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}
