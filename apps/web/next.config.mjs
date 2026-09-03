import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The workspace keeps local provider credentials in its root `.env`, while
// Next runs from `apps/web`. Load that server-side file once so API routes and
// local marketplace runtimes receive the same configured AI Models fallback.
try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
} catch {
  // A fresh install may not have a root .env yet; the settings UI remains the
  // supported configuration path in that case.
}

// Read version from package.json at build time
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@larkup/connections',
    '@larkup/core',
    '@larkup/vector-stores',
    '@larkup/scraper',
    '@larkup/marketplace',
    '@larkup/sandbox',
  ],
  serverExternalPackages: [
    '@lancedb/lancedb',
    '@ffmpeg-installer/ffmpeg',
    '@ffprobe-installer/ffprobe',
    'chromadb',
    '@chroma-core/default-embed',
    'dockerode',
    'node-ssh',
    'nodejs-whisper',
    '@napi-rs/canvas',
    'pdf-parse',
  ],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  output: process.env.E2E_BUILD ? undefined : 'standalone',
  // Standalone tracing runs from this monorepo and must never recursively
  // package generated dev/desktop outputs. Besides bloating releases, stale
  // build copies can retain environment names that source code no longer uses.
  outputFileTracingExcludes: {
    '/*': [
      '.next/dev/**/*',
      '.next/standalone/**/*',
      '../desktop/src-tauri/target/**/*',
    ],
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  async rewrites() {
    return [
      {
        source: '/uploads/:path*',
        destination: '/api/uploads/:path*',
      },
    ];
  },
  webpack: (config) => {
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      { module: /ffmpeg-spawn\.js/ },
    ];
    return config;
  },
  // `next dev` runs on Turbopack by default (only `next build --webpack` above
  // hits the `webpack()` hook), so the ffmpeg-spawn warning needs its own
  // Turbopack-side suppression: https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopackIgnoreIssue
  turbopack: {
    ignoreIssue: [{ path: '**/ffmpeg-spawn.js', title: 'Module not found' }],
  },
};

export default nextConfig;
