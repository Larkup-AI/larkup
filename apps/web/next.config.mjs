/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@larkup-rag/core",
    "@larkup-rag/vector-stores",
    "@larkup-rag/scraper",
  ],
  serverExternalPackages: ["@lancedb/lancedb", "chromadb"],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  output: "standalone",
};

export default nextConfig;
