/**
 * Agent store — persists AgentDefinition and AgentRelease to disk.
 *
 * Storage layout under .larkup/:
 *   agents/
 *     <agentId>/
 *       config.json        — mutable AgentDefinition
 *       releases/
 *         <releaseId>.json — immutable AgentRelease snapshots (ADR-002)
 *       active-release.txt — releaseId of the currently active release
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AgentDefinition, AgentRelease, LockedExtension } from '@larkup/agent-contracts';

/* ------------------------------------------------------------------ */
/* Workspace root resolution                                           */
/* ------------------------------------------------------------------ */

async function getDataDir(): Promise<string | null> {
  try {
    const { getDataDir: _get } = await import('./workspace');
    return _get();
  } catch {
    return null;
  }
}

async function requireDataDir(): Promise<string> {
  const { requireDataDir: _req } = await import('./workspace');
  return _req();
}

/* ------------------------------------------------------------------ */
/* Paths                                                               */
/* ------------------------------------------------------------------ */

async function agentsRoot(create = false): Promise<string> {
  const dir = create ? await requireDataDir() : await getDataDir();
  if (!dir) throw new Error('No workspace data directory configured.');
  return path.join(dir, 'agents');
}

function agentDir(root: string, agentId: string) {
  return path.join(root, agentId);
}

function releasesDir(root: string, agentId: string) {
  return path.join(root, agentId, 'releases');
}

/* ------------------------------------------------------------------ */
/* Content-addressing                                                  */
/* ------------------------------------------------------------------ */

export function hashAgentRelease(
  definition: AgentDefinition,
  extensions: Record<string, LockedExtension>,
): string {
  const payload = JSON.stringify({ definition, extensions });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

/* ------------------------------------------------------------------ */
/* Agent CRUD                                                          */
/* ------------------------------------------------------------------ */

export async function listAgents(): Promise<string[]> {
  const root = await agentsRoot();
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

export async function readAgent(agentId: string): Promise<AgentDefinition | null> {
  const root = await agentsRoot();
  const configPath = path.join(agentDir(root, agentId), 'config.json');
  try {
    return JSON.parse(await fs.readFile(configPath, 'utf8')) as AgentDefinition;
  } catch {
    return null;
  }
}

export async function writeAgent(definition: AgentDefinition): Promise<void> {
  const root = await agentsRoot(true);
  const dir = agentDir(root, definition.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(releasesDir(root, definition.id), { recursive: true });
  await fs.writeFile(
    path.join(dir, 'config.json'),
    JSON.stringify({ ...definition, updatedAt: new Date().toISOString() }, null, 2),
    'utf8',
  );
}

export async function deleteAgent(agentId: string): Promise<void> {
  const root = await agentsRoot();
  await fs.rm(agentDir(root, agentId), { recursive: true, force: true });
}

/* ------------------------------------------------------------------ */
/* Release management                                                  */
/* ------------------------------------------------------------------ */

export async function publishRelease(
  agentId: string,
  version: string,
  extensions: Record<string, LockedExtension>,
  releaseNotes?: string,
  publishedBy?: string,
): Promise<AgentRelease> {
  const definition = await readAgent(agentId);
  if (!definition) throw new Error(`Agent "${agentId}" not found.`);

  const releaseId = hashAgentRelease(definition, extensions);
  const root = await agentsRoot(true);
  const relDir = releasesDir(root, agentId);
  await fs.mkdir(relDir, { recursive: true });

  const releasePath = path.join(relDir, `${releaseId}.json`);

  // Idempotent: republishing identical content returns the existing release
  // rather than creating a duplicate. It still becomes the active one — the
  // operator pressed Publish, and that has to mean something.
  try {
    const existing = JSON.parse(await fs.readFile(releasePath, 'utf8')) as AgentRelease;
    await setActiveRelease(agentId, releaseId);
    return { ...existing, isActive: true };
  } catch {
    /* not yet published */
  }

  const release: AgentRelease = {
    agentId,
    releaseId,
    version,
    publishedAt: new Date().toISOString(),
    definition,
    installedExtensions: extensions,
    releaseNotes,
    isActive: true,
    publishedBy,
  };

  await fs.writeFile(releasePath, JSON.stringify(release, null, 2), 'utf8');

  // Publishing activates. Plan §1.2 makes publish the explicit act that takes a
  // draft live; leaving the pointer unset meant a user's *first* publish
  // produced an agent that still answered "no active release, publish one
  // first". Rollback moves the pointer back to a prior release.
  await setActiveRelease(agentId, releaseId);

  return release;
}

export async function listReleases(agentId: string): Promise<AgentRelease[]> {
  const root = await agentsRoot();
  const relDir = releasesDir(root, agentId);
  try {
    const files = await fs.readdir(relDir);
    const releases = await Promise.all(
      files
        .filter((f) => f.endsWith('.json'))
        .map(
          async (f) => JSON.parse(await fs.readFile(path.join(relDir, f), 'utf8')) as AgentRelease,
        ),
    );
    releases.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    const activeId = await getActiveReleaseId(agentId);
    return releases.map((r) => ({ ...r, isActive: r.releaseId === activeId }));
  } catch {
    return [];
  }
}

export async function getRelease(agentId: string, releaseId: string): Promise<AgentRelease | null> {
  const root = await agentsRoot();
  const releasePath = path.join(releasesDir(root, agentId), `${releaseId}.json`);
  try {
    const release = JSON.parse(await fs.readFile(releasePath, 'utf8')) as AgentRelease;
    const activeId = await getActiveReleaseId(agentId);
    return { ...release, isActive: release.releaseId === activeId };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Active release pointer                                              */
/* ------------------------------------------------------------------ */

export async function getActiveReleaseId(agentId: string): Promise<string | null> {
  const root = await agentsRoot();
  const ptrPath = path.join(agentDir(root, agentId), 'active-release.txt');
  try {
    return (await fs.readFile(ptrPath, 'utf8')).trim();
  } catch {
    return null;
  }
}

export async function setActiveRelease(agentId: string, releaseId: string): Promise<void> {
  const root = await agentsRoot(true);
  await fs.writeFile(path.join(agentDir(root, agentId), 'active-release.txt'), releaseId, 'utf8');
}

export async function getActiveRelease(agentId: string): Promise<AgentRelease | null> {
  const id = await getActiveReleaseId(agentId);
  if (!id) return null;
  return getRelease(agentId, id);
}
