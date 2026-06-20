import { NextResponse } from "next/server";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * POST /api/vector-stores/install
 *
 * Install an optional vector store package on demand.
 * Only works in local development — not on serverless (Vercel) production.
 *
 * Body: { "storeId": "chroma" }
 */
export async function POST(request: Request) {
  // Block in production — pnpm add can't run on Vercel
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      {
        error:
          'Package installation is only available in local development. For production, add "chromadb" to your dependencies before deploying.',
      },
      { status: 403 },
    );
  }

  const body = await request.json();
  const { storeId } = body;

  // Only Chroma is installable for now
  const INSTALLABLE: Record<string, { pkg: string; version: string }> = {
    chroma: { pkg: "chromadb", version: "^1.9.0" },
  };

  const entry = INSTALLABLE[storeId];
  if (!entry) {
    return NextResponse.json(
      { error: `Store "${storeId}" is not installable or not recognized.` },
      { status: 400 },
    );
  }

  try {
    const cmd = `pnpm add ${entry.pkg}@${entry.version} --filter @larkup-rag/vector-stores`;
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: process.cwd(),
      timeout: 120_000, // 2 minute timeout
    });

    return NextResponse.json({
      success: true,
      package: entry.pkg,
      version: entry.version,
      output: stdout || stderr,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: `Failed to install ${entry.pkg}: ${err.message}`,
        output: err.stderr || err.stdout,
      },
      { status: 500 },
    );
  }
}
