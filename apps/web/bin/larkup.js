#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

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
} else {
  console.error('Usage: larkup <dev|start|update>');
  process.exit(1);
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
