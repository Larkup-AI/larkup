import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { DEFAULT_CONFIG, type RagConfig } from './types';

/**
 * The clean local Project persistence boundary.
 *
 * A Project owns one Knowledge API, one Assistant configuration, one local
 * runtime, and every local record required to run or deploy them. It does not
 * read the legacy server/agent directories and deliberately has no migration
 * path: this refactor starts from an explicit local reset.
 */
export interface ProjectMeta {
  id: string;
  name: string;
  port: number;
  /** Exactly one project may be active on a local machine. */
  active?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectWorkspace {
  activeProjectId: string | null;
  projects: ProjectMeta[];
}

const BASE_PORT = 8080;
const EMPTY_WORKSPACE: ProjectWorkspace = { activeProjectId: null, projects: [] };
const projectScope = new AsyncLocalStorage<{ projectId: string }>();

let writeChain: Promise<unknown> = Promise.resolve();

/**
 * Resolve the durable local-state root. Packaged Larkup sets
 * `LARKUP_DATA_DIR` before launching so npm can replace its own installation
 * directory without replacing a user's projects, credentials, or indexes.
 * Development, Docker, and direct library consumers retain the local
 * `./.larkup` default unless they explicitly opt in to another root.
 */
export function getLarkupDataDir(): string {
  const configured = process.env.LARKUP_DATA_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(process.cwd(), '.larkup');
}

function projectsDir(): string {
  return path.join(getLarkupDataDir(), 'projects');
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const run = writeChain.then(operation, operation);
  writeChain = run.catch(() => undefined);
  return run;
}

async function readWorkspaceFile(): Promise<ProjectWorkspace> {
  try {
    const entries = await fs.readdir(projectsDir(), { withFileTypes: true });
    const projects = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          try {
            return JSON.parse(
              await fs.readFile(path.join(projectsDir(), entry.name, 'project.json'), 'utf8'),
            ) as ProjectMeta;
          } catch {
            return null;
          }
        }),
    );
    const resolvedProjects = projects.filter((project): project is ProjectMeta => project !== null);
    const activeProjectId = resolvedProjects.find((project) => project.active)?.id ?? null;
    return {
      activeProjectId,
      projects: resolvedProjects,
    };
  } catch {
    return EMPTY_WORKSPACE;
  }
}

async function writeWorkspaceFile(workspace: ProjectWorkspace): Promise<ProjectWorkspace> {
  await fs.mkdir(projectsDir(), { recursive: true });
  await Promise.all(
    workspace.projects.map(async (project) => {
      const persisted = { ...project, active: project.id === workspace.activeProjectId };
      await fs.mkdir(projectDir(project.id), { recursive: true });
      await fs.writeFile(
        path.join(projectDir(project.id), 'project.json'),
        JSON.stringify(persisted, null, 2),
        'utf8',
      );
    }),
  );
  return workspace;
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function nextPort(workspace: ProjectWorkspace): Promise<number> {
  let port = Math.max(BASE_PORT - 1, ...workspace.projects.map((project) => project.port)) + 1;
  while (!(await isPortFree(port))) port += 1;
  return port;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'my-larkup'
  );
}

function initialConfig(project: ProjectMeta): RagConfig {
  const configuredDataRoot = process.env.LARKUP_DATA_DIR?.trim();
  return {
    ...DEFAULT_CONFIG,
    projectName: slugify(project.name),
    storeConfig: {
      ...DEFAULT_CONFIG.storeConfig,
      mode: 'local',
      dbPath: configuredDataRoot
        ? path.join(getLarkupDataDir(), 'projects', project.id, 'index')
        : `./.larkup/projects/${project.id}/index`,
    },
    updatedAt: new Date().toISOString(),
  };
}

/** Runs an operation with a Project selected without mutating global state. */
export function runWithProject<T>(projectId: string, operation: () => T): T {
  return projectScope.run({ projectId }, operation);
}

/** Returns the Project directory. This function never resolves legacy paths. */
export function projectDir(projectId: string): string {
  return path.join(projectsDir(), projectId);
}

/** Reads the clean Project workspace. */
export async function getProjectWorkspace(): Promise<ProjectWorkspace> {
  return readWorkspaceFile();
}

/** Resolves the request-scoped or active Project. */
export async function getActiveProject(): Promise<ProjectMeta | null> {
  const workspace = await getProjectWorkspace();
  const projectId = projectScope.getStore()?.projectId ?? workspace.activeProjectId;
  return workspace.projects.find((project) => project.id === projectId) ?? null;
}

/** Resolves the data directory for the active Project, without creating one. */
export async function getProjectDataDir(): Promise<string | null> {
  const project = await getActiveProject();
  if (!project) return null;
  const dir = projectDir(project.id);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Resolves the active Project directory for a write. A first write creates
 * one default Project so local APIs never write to an implicit global corpus.
 */
export async function requireProjectDataDir(): Promise<string> {
  const dir = await getProjectDataDir();
  if (dir) return dir;
  if (projectScope.getStore()?.projectId) {
    throw new Error(`Project "${projectScope.getStore()?.projectId}" does not exist.`);
  }
  const { project } = await createProject('My project');
  return projectDir(project.id);
}

/** Creates the one root entity used by the application. */
export function createProject(
  name: string,
): Promise<{ workspace: ProjectWorkspace; project: ProjectMeta }> {
  return serialize(async () => {
    const workspace = await readWorkspaceFile();
    const now = new Date().toISOString();
    const project: ProjectMeta = {
      id: randomUUID(),
      name: name.trim() || 'Untitled project',
      port: await nextPort(workspace),
      createdAt: now,
      updatedAt: now,
    };
    const dir = projectDir(project.id);
    await fs.mkdir(path.join(dir, 'releases'), { recursive: true });
    await Promise.all([
      fs.writeFile(
        path.join(dir, 'project.json'),
        JSON.stringify({ ...project, active: true }, null, 2),
        'utf8',
      ),
      fs.writeFile(
        path.join(dir, 'config.json'),
        JSON.stringify(initialConfig(project), null, 2),
        'utf8',
      ),
      fs.writeFile(
        path.join(dir, 'groups.json'),
        JSON.stringify(
          [
            {
              id: 'default',
              name: 'Default',
              description: 'Sources added without a specific group.',
              icon: '📚',
              assistantEnabled: true,
              createdAt: now,
              updatedAt: now,
            },
          ],
          null,
          2,
        ),
        'utf8',
      ),
      fs.writeFile(path.join(dir, 'documents.json'), '[]\n', 'utf8'),
      fs.writeFile(path.join(dir, 'deployments.json'), '[]\n', 'utf8'),
      fs.writeFile(path.join(dir, 'automations.json'), '[]\n', 'utf8'),
      fs.writeFile(path.join(dir, 'jobs.json'), '[]\n', 'utf8'),
      fs.writeFile(path.join(dir, 'runtime.json'), '{}\n', 'utf8'),
    ]);
    const next: ProjectWorkspace = {
      activeProjectId: project.id,
      projects: [...workspace.projects.map((item) => ({ ...item, active: false })), project],
    };
    await writeWorkspaceFile(next);
    return { workspace: next, project };
  });
}

/** Changes the active Project after confirming it exists. */
export function setActiveProject(projectId: string): Promise<ProjectWorkspace> {
  return serialize(async () => {
    const workspace = await readWorkspaceFile();
    if (!workspace.projects.some((project) => project.id === projectId)) return workspace;
    return writeWorkspaceFile({ ...workspace, activeProjectId: projectId });
  });
}

/** Renames a Project and its generated-server label without changing its id. */
export function renameProject(projectId: string, name: string): Promise<ProjectWorkspace> {
  return serialize(async () => {
    const workspace = await readWorkspaceFile();
    const projects = workspace.projects.map((project) =>
      project.id === projectId
        ? { ...project, name: name.trim() || project.name, updatedAt: new Date().toISOString() }
        : project,
    );
    const next = await writeWorkspaceFile({ ...workspace, projects });
    const renamed = projects.find((project) => project.id === projectId);
    if (renamed) {
      const configFile = path.join(projectDir(projectId), 'config.json');
      try {
        const config = JSON.parse(await fs.readFile(configFile, 'utf8')) as RagConfig;
        await fs.writeFile(
          configFile,
          JSON.stringify(
            { ...config, projectName: slugify(renamed.name), updatedAt: new Date().toISOString() },
            null,
            2,
          ),
          'utf8',
        );
      } catch {
        // The project metadata remains usable if a manually damaged config cannot be updated.
      }
    }
    return next;
  });
}

/** Permanently deletes exactly one Project directory and its workspace entry. */
export function deleteProject(projectId: string): Promise<ProjectWorkspace> {
  return serialize(async () => {
    const workspace = await readWorkspaceFile();
    const projects = workspace.projects.filter((project) => project.id !== projectId);
    await fs.rm(projectDir(projectId), { recursive: true, force: true });
    return writeWorkspaceFile({
      activeProjectId:
        workspace.activeProjectId === projectId
          ? (projects[0]?.id ?? null)
          : workspace.activeProjectId,
      projects,
    });
  });
}

/**
 * Removes every local Project after the caller has displayed this exact path
 * in a destructive confirmation UI/CLI. No legacy data is read or migrated.
 */
export async function resetLocalProjects(confirmedPath: string): Promise<void> {
  const target = projectsDir();
  if (confirmedPath !== target) {
    throw new Error(`Confirmation must exactly match ${target}.`);
  }
  await serialize(async () => {
    await fs.rm(target, { recursive: true, force: true });
  });
}
