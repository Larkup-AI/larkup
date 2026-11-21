import { readdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { integrations } from '@larkup/integrations';
const root = new URL('../assets/', import.meta.url);
const assets = {};
async function visit(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory())
      await visit(new URL(entry.name + '/', directory), prefix + entry.name + '/');
    else
      assets[prefix + entry.name] = (await readFile(new URL(entry.name, directory))).toString(
        'base64',
      );
  }
}
await visit(root);
await writeFile(new URL('../src/asset-data.json', import.meta.url), JSON.stringify(assets));

// Catalog icons render at 24–36px. Bundle 2x thumbnails to avoid one request per card.
const integrationIcons = {};
for (const icon of [...new Set(integrations.map((integration) => integration.icon))].sort()) {
  if (!icon.startsWith('/')) continue;
  const bytes = await readFile(new URL(icon.slice(1), root));
  const vector = icon.endsWith('.svg');
  const thumbnail = vector
    ? bytes
    : await sharp(bytes)
        .rotate()
        .resize({ width: 72, height: 72, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85, alphaQuality: 100, effort: 6 })
        .toBuffer();
  integrationIcons[icon] =
    `data:image/${vector ? 'svg+xml' : 'webp'};base64,${thumbnail.toString('base64')}`;
}
await writeFile(
  new URL('../src/integration-icon-data.json', import.meta.url),
  JSON.stringify(integrationIcons),
);
