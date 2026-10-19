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
  if (manifest.version !== version) {
    console.log(`  ${entry.name}: ${manifest.version} -> ${version}`);
    manifest.version = version;
    // Keep the file's existing shape: two-space indent, trailing newline.
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    changed += 1;
  }

  const indexPath = path.join(toolDir, 'src/index.ts');
  try {
    const indexSource = readFileSync(indexPath, 'utf8');
    const updatedIndexSource = indexSource.replace(
      /(TOOL_META\s*=\s*{[\s\S]*?version:\s*['"])([^'"]+)(['"])/,
      (match, prefix, oldVersion, suffix) => {
        if (oldVersion !== version) {
          console.log(`  ${entry.name} (src/index.ts): ${oldVersion} -> ${version}`);
          changed += 1;
          return `${prefix}${version}${suffix}`;
        }
        return match;
      },
    );
    if (updatedIndexSource !== indexSource) {
      writeFileSync(indexPath, updatedIndexSource);
    }
  } catch {
    // not every tool has a src/index.ts
  }

  const toolId = manifest.id;
  if (toolId) {
    const builtinPath = path.resolve('packages/marketplace/src/db/builtin-tools.ts');
    try {
      const builtinSource = readFileSync(builtinPath, 'utf8');
      const toolPattern = new RegExp(
        `(id:\\s*['"]${toolId}['"][\\s\\S]*?version:\\s*['"])([^'"]+)(['"])`,
      );
      if (toolPattern.test(builtinSource)) {
        const updated = builtinSource.replace(toolPattern, (m, p1, oldV, p3) => {
          if (oldV !== version) {
            console.log(`  ${toolId} (builtin-tools.ts): ${oldV} -> ${version}`);
            changed += 1;
            return `${p1}${version}${p3}`;
          }
          return m;
        });
        if (updated !== builtinSource) {
          writeFileSync(builtinPath, updated);
        }
      }
    } catch {
      // ignore
    }

    const registryTestPath = path.resolve('packages/marketplace/src/tool-registry.test.ts');
    try {
      const testSource = readFileSync(registryTestPath, 'utf8');
      const testPattern = new RegExp(
        `(id:\\s*['"]${toolId}['"][\\s\\S]*?version:\\s*['"])([^'"]+)(['"])`,
      );
      if (testPattern.test(testSource)) {
        const updated = testSource.replace(testPattern, (m, p1, oldV, p3) => {
          if (oldV !== version) {
            console.log(`  ${toolId} (tool-registry.test.ts): ${oldV} -> ${version}`);
            changed += 1;
            return `${p1}${version}${p3}`;
          }
          return m;
        });
        if (updated !== testSource) {
          writeFileSync(registryTestPath, updated);
        }
      }
    } catch {
      // ignore
    }
  }
}

console.log(changed ? `Synced ${changed} tool file(s).` : 'Tool versions already match.');
