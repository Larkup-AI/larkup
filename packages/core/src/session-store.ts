/**
 * Conversation sessions for channels.
 *
 * The widget keeps its transcript in the browser; a channel cannot. Telegram
 * hands us one message at a time with no history, so without a server-side
 * session every reply would answer in a vacuum — "yes, that one" would be
 * meaningless. This is the minimum store that makes a channel conversation feel
 * like a conversation.
 *
 * Storage layout under .larkup/:
 *   sessions/
 *     <sessionId>.json — { updatedAt, messages: [...] }
 *
 * Deliberately small:
 * - Only the last `MAX_TURNS` turns are kept, so a long-running chat cannot grow
 *   a prompt (or a bill) without bound.
 * - Sessions expire after `TTL_MS` of inactivity and are swept on read.
 * - Session ids are already hashed by `@larkup/connections`, so no provider
 *   user id or phone number is written to disk here.
 *
 * TASK 08 replaces the filesystem with the control plane's store; the interface
 * is what matters.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
export interface ProjectSessionMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Turns retained per session (user + assistant messages, not pairs). */
const MAX_TURNS = 20;

/** Inactivity after which a session is forgotten. */
const TTL_MS = 24 * 60 * 60 * 1000;

interface StoredSession {
  updatedAt: string;
  messages: ProjectSessionMessage[];
}

async function sessionsRoot(create = false): Promise<string> {
  const { getProjectDataDir, requireProjectDataDir } = await import('./project-store');
  const dir = create ? await requireProjectDataDir() : await getProjectDataDir();
  if (!dir) throw new Error('No Project data directory configured.');
  return path.join(dir, 'sessions');
}

/** Session ids come from `deriveSession`, but never trust an id from a caller. */
function sessionFile(root: string, sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) throw new Error('Invalid session id.');
  return path.join(root, `${safe}.json`);
}

/** Read the conversation so far. Returns `[]` for a new or expired session. */
export async function readSession(sessionId: string): Promise<ProjectSessionMessage[]> {
  try {
    const root = await sessionsRoot();
    const raw = await fs.readFile(sessionFile(root, sessionId), 'utf8');
    const stored = JSON.parse(raw) as StoredSession;

    if (Date.now() - Date.parse(stored.updatedAt) > TTL_MS) {
      await deleteSession(sessionId);
      return [];
    }
    return Array.isArray(stored.messages) ? stored.messages : [];
  } catch {
    return [];
  }
}

/**
 * Append one exchange and persist the trimmed transcript.
 *
 * Trimming keeps the *most recent* turns: for support-style channel traffic the
 * live thread matters more than the opening of a day-old conversation.
 */
export async function appendToSession(
  sessionId: string,
  userMessage: string,
  assistantMessage: string,
): Promise<ProjectSessionMessage[]> {
  const previous = await readSession(sessionId);
  const messages: ProjectSessionMessage[] = (
    [
      ...previous,
      { role: 'user', content: userMessage },
      { role: 'assistant', content: assistantMessage },
    ] satisfies ProjectSessionMessage[]
  ).slice(-MAX_TURNS);

  const root = await sessionsRoot(true);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(
    sessionFile(root, sessionId),
    JSON.stringify({ updatedAt: new Date().toISOString(), messages } satisfies StoredSession),
    'utf8',
  );

  return messages;
}

export async function deleteSession(sessionId: string): Promise<void> {
  try {
    const root = await sessionsRoot();
    await fs.rm(sessionFile(root, sessionId), { force: true });
  } catch {
    // Nothing to delete.
  }
}

/**
 * Remove expired sessions. Cheap enough to call on a schedule; not called
 * automatically, because a request path should not pay for housekeeping.
 */
export async function sweepSessions(): Promise<number> {
  let removed = 0;
  try {
    const root = await sessionsRoot();
    for (const entry of await fs.readdir(root)) {
      if (!entry.endsWith('.json')) continue;
      const file = path.join(root, entry);
      try {
        const stored = JSON.parse(await fs.readFile(file, 'utf8')) as StoredSession;
        if (Date.now() - Date.parse(stored.updatedAt) > TTL_MS) {
          await fs.rm(file, { force: true });
          removed += 1;
        }
      } catch {
        await fs.rm(file, { force: true });
        removed += 1;
      }
    }
  } catch {
    // No sessions directory yet.
  }
  return removed;
}
