import { readFileSync } from "node:fs";

// Read version from package.json at build time
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@larkup/core",
    "@larkup/vector-stores",
    "@larkup/scraper",
    "@larkup/marketplace",
  ],
  serverExternalPackages: ["@lancedb/lancedb", "chromadb", "dockerode"],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  output: process.env.E2E_BUILD ? undefined : "standalone",
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  async rewrites() {
    return [
      {
        source: "/uploads/:path*",
        destination: "/api/uploads/:path*",
      },
    ];
  },
};

export default nextConfig;
