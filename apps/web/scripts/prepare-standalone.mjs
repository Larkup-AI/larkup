import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const standaloneRoot = path.resolve('.next/standalone');
const appRoot = path.join(standaloneRoot, 'apps/web');

if (!existsSync(standaloneRoot)) {
  process.exit(0);
}

removeDanglingSymlinks(standaloneRoot);

rmSync(path.join(appRoot, '.larkup'), { force: true, recursive: true });
rmSync(path.join(appRoot, '.larkupdb'), { force: true, recursive: true });
rmSync(path.join(appRoot, '.env.local'), { force: true });
rmSync(path.join(appRoot, 'public'), { force: true, recursive: true });

copyDirectory('.next/static', path.join(appRoot, '.next/static'));
copyDirectory('public', path.join(appRoot, 'public'));

pruneOtherPlatformNativePackages();
removeDanglingSymlinks(standaloneRoot);

function copyDirectory(source, destination) {
  if (!existsSync(source)) return;

  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true });
}

function pruneOtherPlatformNativePackages() {
  const packageStore = path.join(standaloneRoot, 'node_modules/.pnpm');
  if (!existsSync(packageStore)) return;

  const libc =
    process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime
      ? 'musl'
      : 'gnu';
  const napiPlatform =
    process.platform === 'linux'
      ? `linux-${process.arch}-${libc}`
      : process.platform === 'win32'
      ? `win32-${process.arch}-msvc`
      : `${process.platform}-${process.arch}`;
  const sharpPlatform =
    process.platform === 'linux' && libc === 'musl'
      ? `linuxmusl-${process.arch}`
      : `${process.platform}-${process.arch}`;
  const keepPrefixes = [
    `@lancedb+lancedb-${napiPlatform}@`,
    `@napi-rs+canvas-${napiPlatform}@`,
    `@img+sharp-${sharpPlatform}@`,
    `@img+sharp-libvips-${sharpPlatform}@`,
  ];

  for (const entry of readdirSync(packageStore)) {
    const isNativePackage = /^(?:@lancedb\+lancedb-|@napi-rs\+canvas-|@img\+sharp-)/.test(entry);
    if (isNativePackage && !keepPrefixes.some((prefix) => entry.startsWith(prefix))) {
      rmSync(path.join(packageStore, entry), { force: true, recursive: true });
    }
  }
}

function removeDanglingSymlinks(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const stat = lstatSync(entryPath);

    if (stat.isSymbolicLink()) {
      if (!existsSync(entryPath)) rmSync(entryPath, { force: true });
      continue;
    }

    if (stat.isDirectory()) removeDanglingSymlinks(entryPath);
  }
}
