/**
 * Copies each marketplace tool's package version into its `tool.manifest.json`.
 *
 * The Hub serves the manifest, npm serves the package, and an installer trusts
 * both. Changesets only knows about `package.json`, so without this step a
 * release publishes a tool whose manifest advertises an older version --
 * `doc-editor` had drifted from 0.2.1 to 0.2.16 that way. Run it after
 * `changeset version`; `pnpm version-packages` does both.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const toolsRoot = path.resolve('packages/marketplace-tools');
let changed = 0;

for (const entry of readdirSync(toolsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;

  const toolDir = path.join(toolsRoot, entry.name);
  const manifestPath = path.join(toolDir, 'tool.manifest.json');
  const packagePath = path.join(toolDir, 'package.json');

  let manifestSource;
  let packageSource;
  try {
    manifestSource = readFileSync(manifestPath, 'utf8');
    packageSource = readFileSync(packagePath, 'utf8');
  } catch {
    continue; // not every directory is a published tool
  }

  const manifest = JSON.parse(manifestSource);
  const { version } = JSON.parse(packageSource);
  if (manifest.version === version) continue;

  console.log(`  ${entry.name}: ${manifest.version} -> ${version}`);
  manifest.version = version;
  // Keep the file's existing shape: two-space indent, trailing newline.
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  changed += 1;
}

console.log(changed ? `Synced ${changed} tool manifest(s).` : 'Tool manifests already match.');
