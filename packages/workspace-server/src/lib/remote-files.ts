import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const MAX_REMOTE_FILE_BYTES = 50 * 1024 * 1024;

const SUPPORTED_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'toml',
  'json',
  'csv',
  'html',
  'htm',
  'log',
  'xlsx',
  'xls',
  'pdf',
  'doc',
  'docx',
]);

const EXTENSION_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/json': 'json',
  'text/csv': 'csv',
  'text/markdown': 'md',
  'text/plain': 'txt',
  'text/html': 'html',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

export interface RemoteFileDownload {
  bytes: Buffer;
  contentType: string;
  fileName: string;
  sourceUrl: string;
}

export function normalizeRemoteFileUrl(value: string): URL {
  const url = new URL(value.trim());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only public http(s) file URLs are supported.');
  }

  // Make share links work without asking people to find a provider-specific
  // "raw" download URL themselves.
  if (url.hostname === 'github.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length >= 5 && parts[2] === 'blob') {
      url.hostname = 'raw.githubusercontent.com';
      url.pathname = `/${parts[0]}/${parts[1]}/${parts.slice(3).join('/')}`;
      url.search = '';
    }
  }
  if (url.hostname === 'huggingface.co' && url.pathname.includes('/blob/')) {
    url.pathname = url.pathname.replace('/blob/', '/resolve/');
  }

  return url;
}

export function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase();
  if (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd')
  ) {
    return true;
  }
  const parts = (normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized)
    .split('.')
    .map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

async function assertPublicHost(hostname: string) {
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('Private or local file URLs are not supported.');
  }
}

export function getRemoteFileName(response: Response, sourceUrl: URL, contentType: string) {
  const disposition = response.headers.get('content-disposition') ?? '';
  const encodedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plainMatch = disposition.match(/filename\s*=\s*"?([^";]+)"?/i)?.[1];
  let name = encodedMatch ? decodeURIComponent(encodedMatch) : plainMatch;

  if (!name) {
    name = decodeURIComponent(sourceUrl.pathname.split('/').filter(Boolean).pop() || 'remote-file');
  }
  name = name.replace(/[\\/\0\r\n]/g, '-').trim() || 'remote-file';

  const extension = name.split('.').pop()?.toLowerCase();
  // GitHub and similar providers return source files as text/plain. Retain an
  // unfamiliar extension (for example .py) instead of relabeling it as .txt.
  if (extension && (SUPPORTED_EXTENSIONS.has(extension) || contentType.startsWith('text/'))) {
    return name;
  }

  const inferredExtension = EXTENSION_BY_MIME[contentType];
  if (inferredExtension) return `${name.replace(/\.[^.]+$/, '')}.${inferredExtension}`;
  throw new Error(
    'This URL does not point to a supported document. Use PDF, Word, CSV, JSON, Excel, or text.',
  );
}

async function readBoundedBody(response: Response) {
  const declaredSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_REMOTE_FILE_BYTES) {
    throw new Error('Remote files must be 50 MB or smaller.');
  }

  if (!response.body) return Buffer.from(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REMOTE_FILE_BYTES) {
        await reader.cancel();
        throw new Error('Remote files must be 50 MB or smaller.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export async function downloadRemoteFile(value: string): Promise<RemoteFileDownload> {
  let current = normalizeRemoteFileUrl(value);
  for (let redirects = 0; redirects <= 5; redirects++) {
    await assertPublicHost(current.hostname);
    const response = await fetch(current, {
      redirect: 'manual',
      headers: { Accept: 'application/pdf,text/*,application/json,application/octet-stream,*/*' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('The file URL redirected without a destination.');
      current = normalizeRemoteFileUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Could not download the file (HTTP ${response.status}).`);

    const contentType = (response.headers.get('content-type') ?? 'application/octet-stream')
      .split(';')[0]
      .trim()
      .toLowerCase();
    return {
      bytes: await readBoundedBody(response),
      contentType,
      fileName: getRemoteFileName(response, current, contentType),
      sourceUrl: current.toString(),
    };
  }
  throw new Error('The file URL redirected too many times.');
}
