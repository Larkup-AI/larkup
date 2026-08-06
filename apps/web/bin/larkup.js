#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync, promises as fs, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(__dirname, '..');
const standaloneServer = path.join(packageDir, '.next', 'standalone', 'apps', 'web', 'server.js');
const pkg = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));

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
  const child = spawn('npm', ['install', '-g', 'larkup@latest'], { stdio: 'inherit' });
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
} else {
  console.error('Usage: larkup <dev|start|update|remove>');
  process.exit(1);
}

async function removeCommand() {
  console.log(
    '\x1b[33mWarning: this permanently removes Larkup, its local database, installed tools, and configuration.\x1b[0m',
  );
  console.log(`Data directory: ${path.join(packageDir, '.larkup')}`);

  const confirmed = await confirm('Continue? Type y or yes to remove Larkup: ');
  if (!confirmed) {
    console.log('Larkup was not removed.');
    return;
  }

  const localRoot = getLocalInstallRoot();
  if (localRoot) {
    await removeLocalInstall(localRoot);
    return;
  }

  await fs.rm(path.join(packageDir, '.larkup'), { recursive: true, force: true });
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
        fetch(new URL('/api/servers', url)),
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
