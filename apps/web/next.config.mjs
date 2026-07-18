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
  ],
  serverExternalPackages: ["@lancedb/lancedb", "chromadb", "dockerode"],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  output: "standalone",
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
};

export default nextConfig;
