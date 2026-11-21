import assert from 'node:assert/strict';
import test from 'node:test';
import { integrations } from '@larkup/integrations';
import { integrationIconSource } from '../src/lib/integration-icons';

test('every catalog logo is bundled within a small page-wide byte budget', () => {
  const sources = [...new Set(integrations.map(({ icon }) => icon))];
  let totalBytes = 0;
  for (const path of sources) {
    const icon = integrationIconSource(path);
    assert.match(icon, /^data:image\/(webp|svg\+xml);base64,/, path);
    const bytes = Buffer.from(icon.split(',')[1], 'base64');
    assert.ok(bytes.length < 8_192, `${path} exceeds the thumbnail budget`);
    if (icon.startsWith('data:image/webp')) {
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
      assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    }
    totalBytes += Buffer.byteLength(icon);
  }
  assert.ok(totalBytes < 150_000, `Logo bundle is too large: ${totalBytes}`);
});

test('host-defined icon URLs pass through unchanged', () => {
  for (const path of ['https://example.test/logo.svg', '/custom-integration.svg', '__proto__']) {
    assert.equal(integrationIconSource(path), path);
  }
});
