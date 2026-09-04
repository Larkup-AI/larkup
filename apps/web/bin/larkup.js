#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync, promises as fs, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(__dirname, '..');
const standaloneServer = path.join(packageDir, '.next', 'standalone', 'apps', 'web', 'server.js');
const pkg = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));

// npm replaces its global package directory during an update. Runtime state
// must therefore live outside that directory. Docker and development can
// still provide LARKUP_DATA_DIR explicitly when they need a mounted/local root.
const larkupDataDir = resolveLarkupDataDir();
process.env.LARKUP_DATA_DIR = larkupDataDir;

const args = process.argv.slice(2);
const command = args[0];

if (command === '--version' || command === '-v') {
  console.log(pkg.version);
} else if (command === 'dev' || command === 'start') {
  const port = process.env.PORT || '4567';
  const url = `http://localhost:${port}`;
  console.log(`\x1b[38;2;223;156;32mStarting Larkup…\x1b[0m`);
  if (!existsSync(standaloneServer)) {
    console.error('Larkup is missing its production server. Reinstall the package and try again.');
    process.exit(1);
  }
  await migrateLegacyRuntimeState();
  const child = spawn(process.execPath, [standaloneServer], {
    cwd: packageDir,
    stdio: 'inherit',
    env: { ...process.env, PORT: port },
  });

  child.once('error', (error) => {
    console.error('Failed to start Larkup:', error.message);
    process.exit(1);
  });
  child.once('exit', (code) => process.exit(code ?? 0));

  void openWhenReady(url);
} else if (command === 'update') {
  console.log('\x1b[38;2;223;156;32mUpdating Larkup…\x1b[0m');
  await migrateLegacyRuntimeState();
  const child = spawn(
    'npm',
    [
      'install',
      '-g',
      '--no-fund',
      '--no-audit',
      '--ignore-scripts',
      '--legacy-peer-deps',
      '--loglevel=error',
      'larkup@latest',
    ],
    { stdio: 'inherit' },
  );
  child.once('error', (error) => {
    console.error('Failed to update Larkup:', error.message);
    process.exit(1);
  });
  child.once('exit', (code) => {
    if (code === 0) console.log('Larkup is up to date. Restart it to use the new version.');
    process.exit(code ?? 0);
  });
} else if (command === 'remove' || command === 'delete') {
  await removeCommand();
} else if (command === 'enterprise-enroll') {
  await enterpriseEnroll(args.slice(1));
} else if (command === 'enterprise-tool' && args[1] === 'install') {
  await installEnterpriseTool(args.slice(2));
} else {
  console.error('Usage: larkup <dev|start|update|remove|enterprise-enroll|enterprise-tool>');
  process.exit(1);
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')
    ? args[index + 1]
    : undefined;
}

function enterpriseEndpoint(baseUrl, pathname) {
  const url = new URL(pathname, baseUrl);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('Enterprise dashboard URL must use HTTPS.');
  }
  return url;
}

function projectRoot() {
  return path.join(larkupDataDir, 'projects');
}

function resolveLarkupDataDir() {
  const configured = process.env.LARKUP_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);
  const home = process.env.HOME;
  return home ? path.join(home, '.larkup') : path.join(packageDir, '.larkup');
}

async function migrateLegacyRuntimeState() {
  const legacyDataDir = path.join(packageDir, '.larkup');
  if (path.resolve(legacyDataDir) === path.resolve(larkupDataDir)) return;
  try {
    await fs.access(larkupDataDir);
    return;
  } catch {
    // The durable directory has not been created yet.
  }
  try {
    await fs.access(legacyDataDir);
    await fs.cp(legacyDataDir, larkupDataDir, { recursive: true, errorOnExist: true });
    console.log(`Migrated local Larkup data to ${larkupDataDir}.`);
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'EEXIST') {
      console.warn('Could not migrate existing local Larkup data:', error.message);
    }
  }
}

async function activeProjectConfig() {
  const root = projectRoot();
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const project = JSON.parse(
        await fs.readFile(path.join(root, entry.name, 'project.json'), 'utf8'),
      );
      if (project.active) {
        return {
          directory: path.join(root, entry.name),
          config: JSON.parse(await fs.readFile(path.join(root, entry.name, 'config.json'), 'utf8')),
        };
      }
    } catch {}
  }
  throw new Error('No active Larkup Project exists. Run enterprise-enroll first.');
}

async function enterpriseEnroll(args) {
  const url = option(args, '--url');
  const key = option(args, '--key');
  if (!url || !key)
    throw new Error('Usage: larkup enterprise-enroll --url <dashboard-url> --key <one-time-key>');
  const response = await fetch(enterpriseEndpoint(url, '/api/enrollment'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: key }),
  });
  const profile = await response.json().catch(() => ({}));
  if (!response.ok || !profile.organization || !profile.installation) {
    throw new Error(profile.error || 'The Enterprise enrollment key is invalid or expired.');
  }

  const root = projectRoot();
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const projectFile = path.join(root, entry.name, 'project.json');
        try {
          const project = JSON.parse(await fs.readFile(projectFile, 'utf8'));
          await fs.writeFile(
            projectFile,
            JSON.stringify({ ...project, active: false }, null, 2),
            'utf8',
          );
        } catch {}
      }),
  );

  const id = randomUUID();
  const now = new Date().toISOString();
  const directory = path.join(root, id);
  const slug =
    String(profile.organization.name)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'enterprise';
  const gatewayKey = profile.configuration?.chatApiKey;
  const config = {
    projectName: profile.organization.name,
    embeddingProvider: profile.configuration?.embeddingProvider || 'openai',
    embeddingApiKey: profile.configuration?.embeddingApiKey || '',
    embeddingModelId: profile.configuration?.embeddingModelId || 'openai/text-embedding-3-small',
    indexType: 'hybrid',
    chunking: { chunkSize: 512, chunkOverlap: 64, strategy: 'recursive' },
    vectorStore: 'lancedb',
    storeConfig: {
      mode: 'local',
      dbPath: path.join(larkupDataDir, 'projects', id, 'index'),
      tableName: 'documents',
    },
    topK: 5,
    chatProvider: profile.configuration?.chatProvider || 'openai',
    chatModelId: profile.configuration?.chatModelId || '',
    chatApiKey: gatewayKey || '',
    toolConfigs: {},
    skills: [],
    enabledTools: [],
    updatedAt: now,
    enterprise: {
      organizationId: profile.organization.id,
      organizationName: profile.organization.name,
      dashboardUrl: new URL(url).origin,
      installationId: profile.installation.id,
      clientKey: profile.installation.clientKey,
      managedToolIds: [],
      enrolledAt: now,
    },
  };
  const project = {
    id,
    name: profile.organization.name,
    port: 8080,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  await fs.mkdir(path.join(directory, 'releases'), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(directory, 'project.json'), JSON.stringify(project, null, 2), 'utf8'),
    fs.writeFile(
      path.join(directory, 'config.json'),
      JSON.stringify({ ...config, projectName: slug }, null, 2),
      'utf8',
    ),
    fs.writeFile(
      path.join(directory, 'groups.json'),
      JSON.stringify(
        [
          {
            id: 'default',
            name: 'Default',
            description: 'Sources added without a specific group.',
            icon: '📚',
            assistantEnabled: true,
            createdAt: now,
            updatedAt: now,
          },
        ],
        null,
        2,
      ),
      'utf8',
    ),
    ...['documents.json', 'deployments.json', 'automations.json', 'jobs.json'].map((file) =>
      fs.writeFile(path.join(directory, file), '[]\n', 'utf8'),
    ),
    fs.writeFile(path.join(directory, 'runtime.json'), '{}\n', 'utf8'),
  ]);
  console.log(
    `Enterprise profile for ${profile.organization.name} is ready. No onboarding is required.`,
  );
  if (profile.managedTools?.length)
    console.log(
      `Private tools available: ${profile.managedTools.map((tool) => tool.id).join(', ')}`,
    );
}

async function installEnterpriseTool(args) {
  const toolId = args[0];
  const apiKey = option(args, '--api-key');
  if (!toolId)
    throw new Error('Usage: larkup enterprise-tool install <tool-id> --api-key <customer-key>');
  const { directory, config } = await activeProjectConfig();
  if (!config.enterprise?.dashboardUrl || !config.enterprise?.clientKey)
    throw new Error('This Project is not enrolled with Enterprise.');
  const response = await fetch(
    enterpriseEndpoint(
      config.enterprise.dashboardUrl,
      `/api/client/tools/${encodeURIComponent(toolId)}/install`,
    ),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.enterprise.clientKey}`,
      },
      body: JSON.stringify({ apiKey }),
    },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.tool)
    throw new Error(result.error || 'Private tool installation failed.');
  config.enterprise.managedToolIds = [
    ...new Set([...(config.enterprise.managedToolIds || []), result.tool.id]),
  ];
  config.updatedAt = new Date().toISOString();
  await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify(config, null, 2), 'utf8');
  console.log(`Installed private tool ${result.tool.name}.`);
}

async function removeCommand() {
  console.log(
    '\x1b[33mWarning: this permanently removes Larkup, its local database, installed tools, and configuration.\x1b[0m',
  );
  console.log(`Data directory: ${larkupDataDir}`);

  const confirmed = await confirm('Continue? Type y or yes to confirm ');
  if (!confirmed) {
    console.log('Larkup was not removed.');
    return;
  }

  const localRoot = getLocalInstallRoot();
  if (localRoot) {
    await fs.rm(larkupDataDir, { recursive: true, force: true });
    await removeLocalInstall(localRoot);
    return;
  }

  await fs.rm(larkupDataDir, { recursive: true, force: true });
  await fs.rm(path.join(packageDir, '.larkupdb'), { recursive: true, force: true });
  await fs.rm(path.join(packageDir, '.next', 'cache'), { recursive: true, force: true });
  await fs.rm(path.join(packageDir, '.env.local'), { force: true });
  await uninstallGlobalPackage();
}

async function confirm(message) {
  if (!process.stdin.isTTY && process.stdin.readableEnded) return false;

  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await prompt.question(message)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } catch {
    return false;
  } finally {
    prompt.close();
  }
}

function getLocalInstallRoot() {
  for (const candidate of [
    path.resolve(packageDir, '..', '..', '..'),
    path.resolve(packageDir, '..', '..', '..', '..'),
  ]) {
    const expectedPackageDirs = [
      path.join(candidate, 'lib', 'node_modules', 'larkup'),
      path.join(candidate, 'lib', 'lib', 'node_modules', 'larkup'),
    ];
    if (
      path.basename(candidate) === '.larkup' &&
      expectedPackageDirs.includes(path.resolve(packageDir)) &&
      existsSync(path.join(candidate, 'node'))
    ) {
      return candidate;
    }
  }

  return null;
}

async function removeLocalInstall(localRoot) {
  await removeLocalPathEntries(localRoot);

  // The isolated installer is supported on macOS/Linux only. Delay removal so
  // its bundled Node process can exit before its own files are deleted.
  const cleaner = spawn('/bin/sh', ['-c', 'sleep 1; rm -rf -- "$1"', 'larkup-remove', localRoot], {
    detached: true,
    stdio: 'ignore',
  });
  cleaner.unref();

  console.log('Larkup removal has been scheduled. Close this terminal, then open a new one.');
  console.log('The larkup command will no longer be available.');
}

async function removeLocalPathEntries(localRoot) {
  const binDir = path.join(localRoot, 'bin');
  const home = process.env.HOME;
  if (!home) return;

  const profiles = [
    path.join(home, '.zshrc'),
    path.join(home, '.bashrc'),
    path.join(home, '.bash_profile'),
    path.join(home, '.profile'),
    path.join(home, '.config', 'fish', 'config.fish'),
  ];

  await Promise.all(
    profiles.map(async (profile) => {
      try {
        const content = await fs.readFile(profile, 'utf8');
        const lines = content.split('\n');
        const next = lines.filter(
          (line, index) =>
            !line.includes(binDir) &&
            !(
              line.trim() === '# Added by Larkup local installer' &&
              lines[index + 1]?.includes(binDir)
            ),
        );
        if (next.length !== lines.length) await fs.writeFile(profile, next.join('\n'), 'utf8');
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }),
  );
}

function uninstallGlobalPackage() {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['uninstall', '-g', 'larkup', '@larkup/cli'], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        console.log(
          'Larkup and its data were removed. Open a new terminal; `larkup` will be command not found.',
        );
        resolve();
        return;
      }
      reject(new Error(`npm uninstall exited with code ${code}`));
    });
  });
}

async function openWhenReady(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      // A standalone Next server can accept the root redirect a few moments
      // before its client route manifests are ready. Opening the browser at
      // that point leaves the UI on its full-screen loading state (or can
      // produce a transient 500). Wait for the route the user will see and
      // the data request that removes that loading state instead.
      const [page, workspace] = await Promise.all([
        fetch(new URL('/chat', url)),
        fetch(new URL('/api/projects', url)),
      ]);
      if (!page.ok || !workspace.ok) throw new Error('Application is not ready');

      const [command, args] = openCommandForPlatform(url);
      const browser = spawn(command, args, { detached: true, stdio: 'ignore' });
      browser.unref();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

function openCommandForPlatform(url) {
  if (process.platform === 'darwin') return ['open', [url]];
  if (process.platform === 'win32') return ['cmd', ['/c', 'start', '', url]];
  return ['xdg-open', [url]];
}
