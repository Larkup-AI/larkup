import { readFileSync } from "node:fs";

// Read version from package.json at build time
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@larkup/core",
    "@larkup/vector-stores",
    "@larkup/scraper",
    "@larkup/sandbox",
    "@larkup/marketplace",
    "@larkup/tool-doc-editor",
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
};

export default nextConfig;
