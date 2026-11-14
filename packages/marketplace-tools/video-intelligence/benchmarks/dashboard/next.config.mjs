/**
 * Next.js config for the local, isolated benchmark dashboard.
 *
 * - This app lives OUTSIDE the larkup pnpm workspace on purpose. Keeping it out
 *   avoids leaking an incompatible dependency graph into the monorepo's root
 *   build/release artifacts. Install and run it with npm from this folder.
 * - No Vercel / standalone deploy target: this runs only on the operator's PC.
 * - The server binds to loopback (see the `dev`/`start` scripts, `-H 127.0.0.1`).
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Do not expose any server-only env (controller URL/token) to the browser.
  // The browser talks only to this app's own /api/v1 BFF, never to the controller.
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  // Source uses standards-compliant `.js` import specifiers that point at `.ts`
  // sources (so the same files also run under Node's type-stripping test loader).
  // Teach webpack to resolve `.js` -> `.ts`/`.tsx` first.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
