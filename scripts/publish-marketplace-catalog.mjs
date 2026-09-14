/**
 * Synchronize newer published tool manifests to the public Marketplace Hub.
 * npm distributes the package; the Hub determines which version Marketplace
 * users are offered, so both must advance together.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const checkOnly = process.argv.includes('--check');

function readDotEnvValue(name) {
  const envPath = path.join(repoRoot, '.env');
  if (!existsSync(envPath)) return undefined;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1 || line.slice(0, separator).trim() !== name) continue;
    const value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      return value.slice(1, -1);
    }
    return value;
  }
  return undefined;
}

function configValue(name, fallback) {
  return process.env[name]?.trim() || readDotEnvValue(name)?.trim() || fallback;
}

function compareVersions(left, right) {
  const parse = (version) => version.split('-', 1)[0].split('.').map(Number);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function readToolManifests() {
  const toolsRoot = path.join(repoRoot, 'packages', 'marketplace-tools');
  return readdirSync(toolsRoot, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return [];
    const manifestPath = path.join(toolsRoot, entry.name, 'tool.manifest.json');
    const packagePath = path.join(toolsRoot, entry.name, 'package.json');
    if (!existsSync(manifestPath) || !existsSync(packagePath)) return [];
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    if (!manifest.id || !manifest.version || packageJson.private) return [];
    if (manifest.version !== packageJson.version) {
      throw new Error(`${entry.name} manifest version does not match package.json.`);
    }
    return [manifest];
  });
}

const hubUrl = configValue('LARKUP_HUB_URL', 'https://hub.larkup.de').replace(/\/$/, '');
const publishKey = configValue('HUB_PUBLISH_KEY');
const pending = [];

for (const manifest of readToolManifests()) {
  const response = await fetch(`${hubUrl}/v1/tools/${encodeURIComponent(manifest.id)}`);
  if (response.status === 404) {
    pending.push(manifest);
    continue;
  }
  if (!response.ok) {
    throw new Error(`Could not read ${manifest.id} from Marketplace Hub (${response.status}).`);
  }
  const remote = await response.json();
  const remoteVersion = remote.tool?.version;
  if (typeof remoteVersion !== 'string') {
    throw new Error(`Marketplace Hub returned no version for ${manifest.id}.`);
  }
  if (compareVersions(manifest.version, remoteVersion) > 0) pending.push(manifest);
}

if (pending.length === 0) {
  console.log('Marketplace Hub catalog is current.');
  process.exit(0);
}

if (!publishKey) {
  throw new Error(
    `Marketplace Hub needs ${pending.map((manifest) => `${manifest.id}@${manifest.version}`).join(', ')}. Set HUB_PUBLISH_KEY in the environment or root .env before publishing.`,
  );
}

if (checkOnly) {
  console.log(
    `Marketplace Hub can publish: ${pending.map((manifest) => `${manifest.id}@${manifest.version}`).join(', ')}.`,
  );
  process.exit(0);
}

for (const manifest of pending) {
  const response = await fetch(`${hubUrl}/v1/tools/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ manifest, apiKey: publishKey }),
  });
  if (response.status === 409) {
    console.log(`Marketplace Hub already has ${manifest.id}@${manifest.version}.`);
    continue;
  }
  if (!response.ok) {
    throw new Error(
      `Could not publish ${manifest.id}@${manifest.version} to Marketplace Hub (${response.status}).`,
    );
  }
  console.log(`Published ${manifest.id}@${manifest.version} to Marketplace Hub.`);
}
