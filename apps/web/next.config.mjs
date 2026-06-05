/** @type {import('next').NextConfig} */
const nextConfig = {
  // Transpile the internal core package (TypeScript source, no build step).
  transpilePackages: ['@buddy-rag/core'],
  // LanceDB ships a native (.node) binding that must not be bundled — keep it
  // external so it's required at runtime from node_modules.
  serverExternalPackages: ['@lancedb/lancedb'],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
