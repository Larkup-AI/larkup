/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@larkup/core",
    "@larkup/vector-stores",
    "@larkup/scraper",
  ],
  serverExternalPackages: ["@lancedb/lancedb", "chromadb"],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
