/** @type {import('next').NextConfig} */
const nextConfig = {
  // Transpile the internal packages (TypeScript source, no build step).
  transpilePackages: ['@larkup-rag/core', '@larkup-rag/vector-stores', '@larkup-rag/scraper'],
  // LanceDB ships a native (.node) binding that must not be bundled — keep it
  // external so it's required at runtime from node_modules.
  serverExternalPackages: ['@lancedb/lancedb', 'chromadb'],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  output: "standalone",
}

export default nextConfig
