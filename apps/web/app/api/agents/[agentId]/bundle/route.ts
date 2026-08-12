import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getActiveRelease, getRelease } from '@larkup/core/agent-store';
import { generateAgentRuntime } from '@larkup/core/generator/generate-agent-runtime';
import { emitAgentEvent } from '@larkup/agent-contracts/observability';

type Params = { params: Promise<{ agentId: string }> };

/**
 * Locate the built widget bundle so the deployed agent can serve `/widget.js`
 * itself, rather than pointing customers back at the dashboard.
 *
 * Best-effort: a bundle without the widget still deploys and still answers the
 * API; only the embeddable bubble is unavailable, and `server.mjs` says so.
 */
async function loadWidgetBundle(): Promise<string | undefined> {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, 'public', 'widget', 'v1.js'),
    path.join(cwd, 'apps', 'web', 'public', 'widget', 'v1.js'),
    path.join(cwd, '..', '..', 'packages', 'agent-widget', 'dist', 'widget.js'),
    path.join(cwd, 'packages', 'agent-widget', 'dist', 'widget.js'),
  ];

  for (const candidate of candidates) {
    try {
      return await readFile(candidate, 'utf8');
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}

/**
 * GET /api/agents/[agentId]/bundle
 *
 * Generate the portable Agent Runtime bundle for a release (plan §8.1, §11.1).
 * Returns the file set, which the dashboard previews and downloads.
 *
 * Query:
 *   `releaseId` — a specific release. Defaults to the active one.
 *   `preview=1` — elide the widget bundle's 220 kB of minified JavaScript.
 *                 The dashboard preview sets this; a download must not.
 *
 * The bundle is generated on demand rather than stored: it is a pure function
 * of an immutable release, so regenerating always produces the same artifact
 * and there is nothing to keep in sync.
 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { agentId } = await params;
    const releaseId = req.nextUrl.searchParams.get('releaseId');

    const release = releaseId
      ? await getRelease(agentId, releaseId)
      : await getActiveRelease(agentId);

    if (!release) {
      return NextResponse.json(
        {
          error: releaseId
            ? `Release "${releaseId}" not found for agent "${agentId}".`
            : `Agent "${agentId}" has no active release. Publish one before deploying.`,
        },
        { status: 409 },
      );
    }

    const preview = req.nextUrl.searchParams.get('preview') === '1';
    const bundle = generateAgentRuntime(release, { widgetBundle: await loadWidgetBundle() });

    emitAgentEvent(
      'deployment.started',
      { agentId, releaseId: release.releaseId },
      {
        payload: { artifact: 'agent-runtime-bundle', files: bundle.files.length },
      },
    );

    return NextResponse.json({
      agentId,
      releaseId: release.releaseId,
      version: release.version,
      projectName: bundle.projectName,
      envVars: bundle.envVars,
      dependencies: bundle.dependencies,
      files: bundle.files.map((file) => ({
        path: file.path,
        language: file.language,
        contents:
          preview && file.path === 'widget.js'
            ? '/* built widget bundle — omitted from the preview, present in the download */'
            : file.contents,
        bytes: Buffer.byteLength(file.contents, 'utf8'),
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
