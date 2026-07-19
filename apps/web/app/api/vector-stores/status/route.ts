import { NextResponse } from 'next/server';

/**
 * GET /api/vector-stores/status
 *
 * Checks whether optional vector store packages are importable.
 * Returns a map of storeId → { installed: boolean }.
 */
export async function GET() {
  const status: Record<string, { installed: boolean }> = {};

  // Check chromadb by reading the vector-stores package.json
  try {
    const fs = await import('fs');
    const path = await import('path');
    const pkgPath = path.join(process.cwd(), '../../packages/vector-stores/package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const hasChroma =
      pkg.dependencies?.chromadb ||
      pkg.devDependencies?.chromadb ||
      pkg.optionalDependencies?.chromadb;
    status.chroma = { installed: !!hasChroma };
  } catch {
    status.chroma = { installed: false };
  }

  return NextResponse.json({ stores: status });
}
