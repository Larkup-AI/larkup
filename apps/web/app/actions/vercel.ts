"use server";

import fs from "fs";
import path from "path";
import { getActiveServer } from "@buddy-rag/core/workspace";

const VERCEL_API = "https://api.vercel.com";

interface VercelProject {
  id: string;
  name: string;
  link?: {
    type: string;
    repo?: string;
    repoId?: number;
    org?: string;
    gitCredentialId?: string;
    productionBranch?: string;
  };
}

interface VercelDeployment {
  id: string;
  uid: string;
  name: string;
  url: string;
  readyState: string;
  target?: string;
}

async function vercelFetch(
  path: string,
  token: string,
  options: RequestInit = {},
) {
  const res = await fetch(`${VERCEL_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = { rawText: text };
  }

  if (!res.ok) {
    const msg =
      body?.error?.message ||
      body?.message ||
      `API error occurred: Status ${res.status} Content-Type "${res.headers.get("content-type")}". Body: ${text}`;
    throw new Error(msg);
  }

  return body;
}

/** Look up a project by name or ID. Returns null if not found. */
async function getProject(
  token: string,
  nameOrId: string,
): Promise<VercelProject | null> {
  try {
    const data = await vercelFetch(
      `/v9/projects/${encodeURIComponent(nameOrId)}`,
      token,
    );
    return data as VercelProject;
  } catch (e: any) {
    if (
      e.message?.toLowerCase().includes("not found") ||
      e.message?.toLowerCase().includes("project not found")
    ) {
      return null;
    }
    throw e;
  }
}

/** Create a new blank Vercel project. */
async function createProject(
  token: string,
  name: string,
): Promise<VercelProject> {
  const data = await vercelFetch(`/v9/projects`, token, {
    method: "POST",
    body: JSON.stringify({ name, framework: null }),
  });
  return data as VercelProject;
}

/** Set an environment variable for the project */
async function setProjectEnv(
  token: string,
  projectId: string,
  key: string,
  value: string,
) {
  // Try to set it. We use the /v10/projects/:id/env endpoint.
  // First, check if it exists so we can patch or post
  const envData = await vercelFetch(`/v9/projects/${projectId}/env`, token);
  const existing = envData.envs?.find((e: any) => e.key === key);

  if (existing) {
    await vercelFetch(`/v9/projects/${projectId}/env/${existing.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({
        value,
        target: ["production", "preview", "development"],
      }),
    });
  } else {
    await vercelFetch(`/v10/projects/${projectId}/env`, token, {
      method: "POST",
      body: JSON.stringify([
        {
          key,
          value,
          target: ["production", "preview", "development"],
          type: "plain",
        },
      ]),
    });
  }
}

function getFilesRecursively(dir: string, baseDir: string): any[] {
  let results: any[] = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    if (file === "node_modules" || file === ".git" || file === "server.log")
      continue;
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFilesRecursively(filePath, baseDir));
    } else {
      const data = fs.readFileSync(filePath);
      const relativePath = path.relative(baseDir, filePath).replace(/\\/g, "/");
      results.push({
        file: relativePath,
        data: data.toString("base64"),
        encoding: "base64",
      });
    }
  }
  return results;
}

/** Deploy by sending files directly. */
async function triggerDeploymentWithFiles(
  token: string,
  project: VercelProject,
  files: any[],
): Promise<VercelDeployment> {
  const body: Record<string, any> = {
    name: project.name,
    target: "production",
    files,
  };

  const data = await vercelFetch(`/v13/deployments`, token, {
    method: "POST",
    body: JSON.stringify(body),
  });

  return data as VercelDeployment;
}

export async function getServerEnvRequirements(serverId: string) {
  let activeId = serverId;
  if (activeId === "default") {
    const server = await getActiveServer();
    if (server) activeId = server.id;
  }

  const cwd = process.cwd();

  // ── Read the LIVE config (not the stale .env.example on disk).
  // This ensures that switching vector stores in the UI is immediately
  // reflected in the env-vars sheet without requiring a server regeneration.
  let vectorStore: string = "lancedb";
  let storeConfig: Record<string, string> = {};
  const configCandidates = [
    path.join(cwd, ".ragtoolkit", "servers", activeId, "config.json"),
    path.join(cwd, ".ragtoolkit", "config.json"),
  ];
  for (const cfgPath of configCandidates) {
    if (fs.existsSync(cfgPath)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
        vectorStore = cfg.vectorStore ?? "lancedb";
        storeConfig = cfg.storeConfig ?? {};
        break;
      } catch {
        // continue to next candidate
      }
    }
  }

  // ── Map storeConfig fields → env var names.
  // The configure page stores credentials as storeConfig.apiKey, storeConfig.indexName, etc.
  // Mirror the same mapping used in server-runtime.ts so configured values are
  // automatically pre-filled as defaults in the env-vars sheet.
  const storeDefaults: Record<string, string> = {};
  if (vectorStore === "pinecone") {
    if (storeConfig.apiKey)          storeDefaults["PINECONE_API_KEY"]       = storeConfig.apiKey;
    if (storeConfig.indexName)       storeDefaults["PINECONE_INDEX"]         = storeConfig.indexName;
    if (storeConfig.namespace)       storeDefaults["PINECONE_NAMESPACE"]     = storeConfig.namespace;
    if (storeConfig.sparseModel)     storeDefaults["PINECONE_SPARSE_MODEL"]  = storeConfig.sparseModel;
    if (storeConfig.sparseIndexName) storeDefaults["PINECONE_SPARSE_INDEX"]  = storeConfig.sparseIndexName;
  } else {
    if (storeConfig.tableName) storeDefaults["LANCEDB_TABLE"]   = storeConfig.tableName;
    if (storeConfig.uri)       storeDefaults["LANCEDB_URI"]     = storeConfig.uri;
    if (storeConfig.apiKey)    storeDefaults["LANCEDB_API_KEY"] = storeConfig.apiKey;
  }

  // ── Canonical env-var list — mirrors generateServer() in generate-server.ts.
  // SERVER_API_KEY, PORT, LANCEDB_PATH, LANCEDB_MODE are handled internally
  // and intentionally omitted here.
  const envVarDefs: { key: string; required: boolean; help: string }[] = [
    {
      key: "AI_GATEWAY_API_KEY",
      required: true,
      help: "Vercel AI Gateway key used to embed incoming queries.",
    },
  ];

  if (vectorStore === "pinecone") {
    envVarDefs.push(
      { key: "PINECONE_API_KEY", required: true, help: "Pinecone API key." },
      { key: "PINECONE_INDEX", required: true, help: "Pinecone index name to query." },
      { key: "PINECONE_NAMESPACE", required: false, help: "Pinecone namespace (default 'default')." },
      { key: "PINECONE_SPARSE_MODEL", required: false, help: "Pinecone sparse model (for hybrid search)." },
      { key: "PINECONE_SPARSE_INDEX", required: false, help: "Pinecone sparse index name (for hybrid search)." },
    );
  } else {
    // lancedb
    envVarDefs.push(
      { key: "LANCEDB_TABLE", required: false, help: "Table name holding the embedded chunks (default 'documents')." },
      { key: "LANCEDB_URI", required: false, help: "LanceDB Cloud database URI (cloud mode)." },
      { key: "LANCEDB_API_KEY", required: false, help: "LanceDB Cloud API key (cloud mode)." },
    );
  }

  // ── Load .env file defaults (lowest priority).
  const rootEnvPath = path.join(cwd, ".env");
  const monoRootEnvPath = path.join(cwd, "../..", ".env");
  const envFileDefaults: Record<string, string> = {};
  for (const envFile of [monoRootEnvPath, rootEnvPath]) {
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
          const [key, ...rest] = trimmed.split("=");
          let val = rest.join("=").trim();
          if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
          else if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
          envFileDefaults[key.trim()] = val;
        }
      }
    }
  }

  // Priority: storeConfig (configure page) > .env file > empty
  return envVarDefs.map((e) => ({
    key: e.key,
    help: e.help,
    required: e.required,
    defaultValue: storeDefaults[e.key] || envFileDefaults[e.key] || "",
  }));
}


export async function deployToVercel(
  token: string,
  projectIdOrName: string,
  serverId: string,
  envVars: Record<string, string> = {}
) {
  let activeId = serverId;
  if (activeId === "default") {
    const server = await getActiveServer();
    if (server) activeId = server.id;
  }

  if (!token || !projectIdOrName) {
    return {
      success: false,
      error: "Vercel token and project ID/name are required.",
    };
  }

  if (!activeId) {
    return {
      success: false,
      error: "Server ID is required to read deployment files.",
    };
  }

  try {
    // 1. Find existing project or create one
    let project = await getProject(token, projectIdOrName);
    const wasNew = !project;

    if (!project) {
      console.log(`Project "${projectIdOrName}" not found. Creating it...`);
      project = await createProject(token, projectIdOrName);
      console.log(`Created project: ${project.id} (${project.name})`);
    }

    // 2. Set environment variables
    for (const [key, value] of Object.entries(envVars)) {
      if (value) {
        await setProjectEnv(token, project.id, key, value);
      }
    }

    // 3. Read the LIVE config to ensure we deploy the latest configuration
    const cwd = process.cwd();
    let config: any = null;
    const configCandidates = [
      path.join(cwd, ".ragtoolkit", "servers", activeId, "config.json"),
      path.join(cwd, ".ragtoolkit", "config.json"),
    ];
    for (const cfgPath of configCandidates) {
      if (fs.existsSync(cfgPath)) {
        try {
          config = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
          break;
        } catch {}
      }
    }

    if (!config) {
      return { success: false, error: "Configuration not found. Please save your settings first." };
    }

    // 4. Generate the server files in memory based on current config
    const { generateServer } = await import("@buddy-rag/core/generator/generate-server");
    const generated = generateServer(config);
    
    const files = generated.files.map((f) => ({
      file: f.path,
      data: Buffer.from(f.contents).toString("base64"),
      encoding: "base64",
    }));

    // 5. Attach LanceDB local data folder ONLY if LanceDB local is actually configured
    const isLanceLocal = config.vectorStore === "lancedb" && config.storeConfig?.mode !== "cloud";
    if (isLanceLocal) {
      await setProjectEnv(token, project.id, "LANCEDB_PATH", "./lancedb");
      const lancedbDir = path.join(cwd, ".ragtoolkit", "servers", activeId, "lancedb");
      if (fs.existsSync(lancedbDir)) {
        const lancedbFiles = getFilesRecursively(
          lancedbDir,
          path.join(cwd, ".ragtoolkit", "servers", activeId)
        );
        files.push(...lancedbFiles);
      }
    }

    if (files.length === 0) {
      return {
        success: false,
        error: "No files found to deploy in the server directory.",
      };
    }

    // 4. Create new deployment with files
    const deployRes = await triggerDeploymentWithFiles(token, project, files);

    // 5. Build canonical production URL
    const url = `https://${project.name}.vercel.app`;

    return {
      success: true,
      url,
      deploymentId: deployRes?.id,
      projectCreated: wasNew,
    };
  } catch (error: any) {
    console.error("Vercel Deploy Error:", error);
    return {
      success: false,
      error: error.message || "Failed to trigger deployment on Vercel.",
    };
  }
}
