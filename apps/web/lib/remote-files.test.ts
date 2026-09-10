import { describe, expect, it } from 'vitest';
import { getRemoteFileName, isPrivateAddress, normalizeRemoteFileUrl } from './remote-files';

describe('remote file URL handling', () => {
  it('turns GitHub and Hugging Face share links into downloadable file URLs', () => {
    expect(
      normalizeRemoteFileUrl('https://github.com/larkup-ai/larkup/blob/main/README.md').toString(),
    ).toBe('https://raw.githubusercontent.com/larkup-ai/larkup/main/README.md');
    expect(
      normalizeRemoteFileUrl('https://huggingface.co/org/data/blob/main/records.json').toString(),
    ).toBe('https://huggingface.co/org/data/resolve/main/records.json');
  });

  it('recognizes private network addresses before a server fetch', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.1.1',
      '172.16.0.1',
      '192.168.1.1',
      '::1',
      'fc00::1',
    ]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
  });

  it('keeps source-code extensions when a host serves them as plain text', () => {
    const source = new URL(
      'https://raw.githubusercontent.com/allenai/OLMo-core/main/src/olmo_core/aliases.py',
    );
    expect(getRemoteFileName(new Response('Alias = str\n'), source, 'text/plain')).toBe(
      'aliases.py',
    );
  });

  it('infers document and workbook extensions from their content type when a URL omits one', () => {
    expect(
      getRemoteFileName(
        new Response(''),
        new URL('https://files.example.com/download'),
        'application/pdf',
      ),
    ).toBe('download.pdf');
    expect(
      getRemoteFileName(
        new Response(''),
        new URL('https://files.example.com/export'),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).toBe('export.xlsx');
  });
});
