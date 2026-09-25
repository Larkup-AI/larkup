import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DataGroup } from './types';
import { getProjectDataDir, runWithProject } from './project-store';

export const DEFAULT_GROUP: DataGroup = {
  id: 'default',
  name: 'Default',
  description: 'Sources added without a specific group.',
  icon: '📚',
  assistantEnabled: true,
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z',
};

const GROUP_ICONS = ['📚', '✦', '◈', '◆', '●', '▦', '✳'];

export class UnknownDataGroupError extends Error {
  constructor(groupId: string) {
    super(`Data group "${groupId}" does not exist.`);
    this.name = 'UnknownDataGroupError';
  }
}

function generatedIcon(id: string): string {
  return GROUP_ICONS[
    [...id].reduce((total, char) => total + char.charCodeAt(0), 0) % GROUP_ICONS.length
  ];
}

let writeChain: Promise<unknown> = Promise.resolve();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const run = writeChain.then(operation, operation);
  writeChain = run.catch(() => undefined);
  return run;
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

async function groupsFile(): Promise<string | null> {
  const dir = await getProjectDataDir();
  return dir ? path.join(dir, 'groups.json') : null;
}

async function writeGroupsFile(file: string, groups: DataGroup[]): Promise<void> {
  const temporaryFile = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(temporaryFile, JSON.stringify(groups, null, 2), 'utf8');
    await fs.rename(temporaryFile, file);
  } catch (error) {
    await fs.unlink(temporaryFile).catch(() => {});
    throw error;
  }
}

/** Reads all groups for the active Project. */
export async function readGroups(): Promise<DataGroup[]> {
  const file = await groupsFile();
  if (!file) return [];
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error(`Invalid group store at ${file}.`);
    const groups = parsed as DataGroup[];
    if (groups.some((group) => group.id === DEFAULT_GROUP.id)) return groups;
    const next = [DEFAULT_GROUP, ...groups];
    await writeGroupsFile(file, next);
    return next;
  } catch (error) {
    if (isMissingFile(error)) return [DEFAULT_GROUP];
    throw error;
  }
}

/**
 * Resolves untrusted request input to a group that exists in the active Project.
 * Older clients can send the string "undefined" through FormData; those sources
 * belong to Default instead of becoming permanently orphaned from the group UI.
 */
export async function resolveGroupId(value: string | null | undefined): Promise<string> {
  const groupId = value?.trim();
  if (!groupId || groupId === 'undefined' || groupId === 'null') return DEFAULT_GROUP.id;

  const groups = await readGroups();
  if (groups.some((group) => group.id === groupId)) return groupId;
  throw new UnknownDataGroupError(groupId);
}

async function writeGroups(groups: DataGroup[]): Promise<DataGroup[]> {
  const file = await groupsFile();
  if (!file) throw new Error('An active Project is required.');
  await writeGroupsFile(file, groups);
  return groups;
}

/** Creates a group enabled for the Project Assistant by default. */
export function createGroup(
  input: Pick<DataGroup, 'name' | 'description' | 'icon'>,
): Promise<DataGroup> {
  return serialize(async () => {
    const groups = await readGroups();
    const now = new Date().toISOString();
    const id = randomUUID();
    const group: DataGroup = {
      id,
      name: input.name.trim() || 'Untitled group',
      description: input.description?.trim() || undefined,
      icon: input.icon?.trim() || generatedIcon(id),
      assistantEnabled: true,
      createdAt: now,
      updatedAt: now,
    };
    await writeGroups([...groups, group]);
    return group;
  });
}

/** Updates display metadata and Assistant availability for one group. */
export function updateGroup(
  groupId: string,
  patch: Partial<Pick<DataGroup, 'name' | 'description' | 'icon' | 'assistantEnabled'>>,
): Promise<DataGroup | null> {
  return serialize(async () => {
    const groups = await readGroups();
    const current = groups.find((group) => group.id === groupId);
    if (!current) return null;
    const next: DataGroup = {
      ...current,
      ...patch,
      name: patch.name?.trim() || current.name,
      description: patch.description?.trim() || undefined,
      updatedAt: new Date().toISOString(),
    };
    await writeGroups(groups.map((group) => (group.id === groupId ? next : group)));
    return next;
  });
}

/** Deletes an empty group. Callers must move or delete its sources first. */
export function deleteGroup(groupId: string): Promise<void> {
  return serialize(async () => {
    if (groupId === DEFAULT_GROUP.id) throw new Error('The Default group cannot be deleted.');
    const groups = await readGroups();
    await writeGroups(groups.filter((group) => group.id !== groupId));
  });
}

/** Executes a group operation for an explicit Project without global mutation. */
export function runWithProjectGroups<T>(projectId: string, operation: () => T): T {
  return runWithProject(projectId, operation);
}
