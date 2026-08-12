import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getDataDir } from '@larkup/core/workspace';

/**
 * Server-side credential storage for the Knowledge Server.
 *
 * Replaces browser localStorage credential storage per ADR-004.
 * Credentials are stored in the workspace data directory (.larkup/credentials.json).
 *
 * GET  /api/config/credentials — read all stored credentials
 * POST /api/config/credentials — update credentials (merge)
 * DELETE /api/config/credentials — clear specific keys
 */

interface StoredCredentials {
  vercelToken?: string;
  serverApiKey?: string;
  serverEnvVars?: Record<string, Record<string, string>>; // serverId → env vars
  vercelProjects?: Record<string, string>; // serverId → project name
  deployedUrls?: Record<string, string>; // serverId → url
  deployedProviders?: Record<string, string>; // serverId → provider
  migratedFromLocalStorage?: boolean;
}

async function credentialsPath(): Promise<string | null> {
  const dir = await getDataDir();
  if (!dir) return null;
  return path.join(dir, 'credentials.json');
}

async function readCredentials(): Promise<StoredCredentials> {
  const p = await credentialsPath();
  if (!p) return {};
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw) as StoredCredentials;
  } catch {
    return {};
  }
}

async function writeCredentials(creds: StoredCredentials): Promise<void> {
  const p = await credentialsPath();
  if (!p) throw new Error('No workspace data directory configured');
  await fs.writeFile(p, JSON.stringify(creds, null, 2), 'utf8');
}

export async function GET() {
  try {
    const creds = await readCredentials();
    // Never return the full Vercel token — only indicate if it's set
    return NextResponse.json({
      hasVercelToken: !!creds.vercelToken,
      vercelTokenPreview: creds.vercelToken ? `${creds.vercelToken.slice(0, 8)}...` : null,
      serverApiKey: creds.serverApiKey ?? '',
      serverEnvVars: creds.serverEnvVars ?? {},
      vercelProjects: creds.vercelProjects ?? {},
      deployedUrls: creds.deployedUrls ?? {},
      deployedProviders: creds.deployedProviders ?? {},
      migratedFromLocalStorage: creds.migratedFromLocalStorage ?? false,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<StoredCredentials> & {
      /** If true, this is a migration from localStorage. Mark as migrated. */
      isMigration?: boolean;
    };
    const existing = await readCredentials();
    const merged: StoredCredentials = {
      ...existing,
      ...(body.vercelToken !== undefined ? { vercelToken: body.vercelToken } : {}),
      ...(body.serverApiKey !== undefined ? { serverApiKey: body.serverApiKey } : {}),
      serverEnvVars: { ...existing.serverEnvVars, ...body.serverEnvVars },
      vercelProjects: { ...existing.vercelProjects, ...body.vercelProjects },
      deployedUrls: { ...existing.deployedUrls, ...body.deployedUrls },
      deployedProviders: { ...existing.deployedProviders, ...body.deployedProviders },
    };
    if (body.isMigration) merged.migratedFromLocalStorage = true;
    await writeCredentials(merged);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as { keys: string[] };
    const existing = await readCredentials();
    for (const key of body.keys ?? []) {
      delete (existing as Record<string, unknown>)[key];
    }
    await writeCredentials(existing);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
