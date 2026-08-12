/**
 * Copy the built Agent Widget bundle into `public/` before `next build`.
 *
 * Why a copy instead of resolving the package at request time: `next build`
 * traces only static imports, so a runtime `require.resolve` into
 * `node_modules/@larkup/agent-widget/dist` would not be included in the
 * standalone output and `/api/widget.js` would 404 in production. Anything
 * under `public/` is copied verbatim, so this makes the bundle a first-class
 * build artifact of the web app.
 *
 * The file is generated, not source — `apps/web/public/widget/` is gitignored.
 */

import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(webDir, '../../packages/agent-widget/dist/widget.js');
const targetDir = path.join(webDir, 'public', 'widget');
const target = path.join(targetDir, 'v1.js');

try {
  const info = await stat(source);
  await mkdir(targetDir, { recursive: true });
  await copyFile(source, target);
  console.log(`[copy-widget] public/widget/v1.js  (${(info.size / 1024).toFixed(1)} kB)`);
} catch (error) {
  if (error && error.code === 'ENOENT') {
    // Not fatal: a developer building only the web app should not be blocked.
    // `/api/widget.js` reports the missing build with an actionable message.
    console.warn(
      '[copy-widget] packages/agent-widget/dist/widget.js not found — run `pnpm --filter @larkup/agent-widget build` to enable the embeddable widget.',
    );
  } else {
    throw error;
  }
}
