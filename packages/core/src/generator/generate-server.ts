import type { RagConfig } from '../types';
import { getVectorStore } from '@larkup/vector-stores/registry';
import { getEmbeddingModel } from '../embeddings/registry';
import {
  AI_SDK_PROVIDER_VERSIONS,
  AI_SDK_VERSION,
  addChatProviderDependency,
  generateChatModule,
  resolveChatModel,
  resolveChatProvider,
} from './chat-module';

export interface GeneratedFile {
  path: string;
  contents: string;
  language: string;
  encoding?: 'utf8' | 'base64';
}

export interface GeneratedServer {
  projectName: string;
  files: GeneratedFile[];
  dependencies: Record<string, string>;
  envVars: { key: string; required: boolean; help: string }[];
}

function lang(path: string): string {
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.mjs') || path.endsWith('.js')) return 'javascript';
  if (path.endsWith('.md')) return 'markdown';
  if (path.endsWith('Dockerfile')) return 'dockerfile';
  if (path.endsWith('.yml') || path.endsWith('.yaml')) return 'yaml';
  return 'text';
}

function lancedbStore(): string {
  return `import * as lancedb from "@lancedb/lancedb"
import path from "node:path"

const MODE = process.env.LANCEDB_MODE || "local"
const IS_SERVERLESS = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME
const DEFAULT_DB_PATH = IS_SERVERLESS ? "/tmp/lancedb" : "./.larkup/lancedb"
const DB_PATH = process.env.LANCEDB_PATH || DEFAULT_DB_PATH
const URI = process.env.LANCEDB_URI || ""
const API_KEY = process.env.LANCEDB_API_KEY || ""
const S3_URI = process.env.LANCEDB_S3_URI || ""
const TABLE = process.env.LANCEDB_TABLE || "documents"

if (IS_SERVERLESS && MODE === "local") {
  console.warn("[LanceDB] Running on serverless — using /tmp/lancedb. Data will NOT persist between invocations. Use S3-compatible storage or LanceDB Cloud for production.")
}

let _conn = null
let _table = null

async function getConn() {
  if (_conn) return _conn
  if (MODE === "cloud") {
    if (!URI || !API_KEY) {
      throw new Error("LanceDB Cloud needs LANCEDB_URI and LANCEDB_API_KEY.")
    }
    _conn = await lancedb.connect(URI, { apiKey: API_KEY })
  } else if (MODE === "s3") {
    if (!S3_URI) {
      throw new Error("S3-compatible LanceDB needs LANCEDB_S3_URI.")
    }
    _conn = await lancedb.connect(S3_URI)
  } else {
    const abs = path.isAbsolute(DB_PATH) ? DB_PATH : path.join(process.cwd(), DB_PATH)
    _conn = await lancedb.connect(abs)
  }
  return _conn
}

async function getTable() {
  if (_table) return _table
  const conn = await getConn()
  const names = await conn.tableNames()
  if (names.includes(TABLE)) {
    _table = await conn.openTable(TABLE)
    return _table
  }
  return null
}

export async function query(vector, topK) {
  const t = await getTable()
  if (!t) return []
  const rows = await t.search(vector).limit(topK).toArray()
  return rows.map((row) => ({
    id: row.id,
    score: typeof row._distance === "number" ? 1 / (1 + row._distance) : 0,
    text: row.text,
    title: row.title,
    url: row.url || undefined,
    documentId: row.documentId,
    metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
  }))
}

export async function list({ page = 1, limit = 20 } = {}) {
  const t = await getTable()
  if (!t) return { documents: [], total: 0, page, limit, totalPages: 0 }
  const allRows = await t.query().select(["id", "text", "title", "url", "documentId"]).toArray()
  const total = allRows.length
  const start = (page - 1) * limit
  const pageRows = allRows.slice(start, start + limit)
  return {
    documents: pageRows.map((row) => ({
      id: row.id,
      text: row.text,
      title: row.title,
      url: row.url || undefined,
      documentId: row.documentId,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  }
}

export async function get(id) {
  const t = await getTable()
  if (!t) return null
  const rows = await t.query().filter(\`id = '\${id}'\`).limit(1).toArray()
  if (!rows.length) return null;
  const row = rows[0];
  return { id: row.id, text: row.text, title: row.title, url: row.url || undefined, documentId: row.documentId }
}

export async function add(docs) {
  if (docs.length === 0) return { success: true }
  let t = await getTable()
  if (t) {
    await t.add(docs)
  } else {
    const conn = await getConn()
    const names = await conn.tableNames()
    if (names.includes(TABLE)) {
      t = await conn.openTable(TABLE)
      _table = t
      await t.add(docs)
    } else {
      t = await conn.createTable(TABLE, docs)
      _table = t
    }
  }
  return { success: true }
}

export async function remove(id) {
  const t = await getTable()
  if (!t) return { success: true }
  await t.delete(\`id = '\${id}'\`)
  return { success: true }
}

export async function update(id, doc) {
  let t = await getTable()
  if (!t) {
    const conn = await getConn()
    t = await conn.createTable(TABLE, [doc])
    _table = t
    return { success: true }
  }
  await t.delete(\`id = '\${id}'\`)
  await t.add([doc])
  return { success: true }
}`;
}

function pineconeStore(): string {
  return `import { Pinecone } from "@pinecone-database/pinecone"

const API_KEY = process.env.PINECONE_API_KEY || ""
const INDEX = process.env.PINECONE_INDEX || ""
const NAMESPACE = process.env.PINECONE_NAMESPACE || "default"

if (!API_KEY) throw new Error("PINECONE_API_KEY is required.")
if (!INDEX) throw new Error("PINECONE_INDEX is required.")

const pc = new Pinecone({ apiKey: API_KEY })
const ns = pc.index(INDEX).namespace(NAMESPACE)

export async function query(vector, topK) {
  const res = await ns.query({ vector, topK, includeMetadata: true })
  return (res.matches ?? []).map((m) => {
    const meta = m.metadata ?? {}
    return {
      id: m.id,
      score: m.score ?? 0,
      text: meta.text ?? "",
      title: meta.title ?? "Untitled",
      url: meta.url || undefined,
      documentId: meta.documentId ?? "",
      metadata: meta,
    }
  })
}

export async function list({ page = 1, limit = 20 } = {}) {
  // Collect all IDs via Pinecone's cursor-based pagination
  const allIds = []
  let paginationToken = undefined
  do {
    const res = await ns.listPaginated({ limit: 100, paginationToken })
    if (res.vectors) allIds.push(...res.vectors.map(v => v.id))
    paginationToken = res.pagination?.next
  } while (paginationToken)

  const total = allIds.length
  const start = (page - 1) * limit
  const pageIds = allIds.slice(start, start + limit)

  if (pageIds.length === 0) {
    return { documents: [], total, page, limit, totalPages: Math.ceil(total / limit) }
  }

  const fetched = await ns.fetch(pageIds)
  const documents = Object.values(fetched.records).map(r => {
    const meta = r.metadata ?? {}
    return {
      id: r.id,
      text: meta.text ?? "",
      title: meta.title ?? "Untitled",
      url: meta.url || undefined,
      documentId: meta.documentId ?? "",
    }
  })
  return { documents, total, page, limit, totalPages: Math.ceil(total / limit) }
}

export async function get(id) {
  const fetched = await ns.fetch([id])
  const r = fetched.records[id]
  if (!r) return null;
  const meta = r.metadata ?? {}
  return {
    id: r.id,
    text: meta.text ?? "",
    title: meta.title ?? "Untitled",
    url: meta.url || undefined,
    documentId: meta.documentId ?? "",
  }
}

export async function add(docs) {
  const vectors = docs.map(d => ({
    id: d.id,
    values: d.vector,
    metadata: {
      ...(d.metadata ?? {}),
      text: d.text,
      title: d.title,
      url: d.url || "",
      documentId: d.documentId,
    }
  }))
  await ns.upsert(vectors)
  return { success: true }
}

export async function remove(id) {
  await ns.deleteOne(id)
  return { success: true }
}

export async function update(id, doc) {
  await ns.update({
    id,
    values: doc.vector,
    setMetadata: {
      ...(doc.metadata ?? {}),
      text: doc.text,
      title: doc.title,
      url: doc.url || "",
      documentId: doc.documentId,
    }
  })
  return { success: true }
}
`;
}

function embedSource(config: RagConfig): string {
  let imports = `import { embed } from "ai"\n`;
  let init = ``;

  if (config.embeddingModelId.startsWith('custom:')) {
    const customName = config.embeddingModelId.slice('custom:'.length);
    const custom = (config.customEmbeddings ?? []).find((m) => m.modelName === customName);
    imports += `import { createOpenAICompatible } from "@ai-sdk/openai-compatible"\n`;
    init = `const provider = createOpenAICompatible({
  name: "custom_provider",
  baseURL: process.env.EMBEDDING_BASE_URL || ${JSON.stringify(custom?.baseUrl || '')},
  apiKey: process.env.EMBEDDING_API_KEY
})
const MODEL = provider.embeddingModel(process.env.EMBEDDING_MODEL || ${JSON.stringify(
      custom?.modelName || '',
    )})`;
  } else if (config.embeddingProvider === 'deepseek') {
    imports += `import { createDeepSeek } from "@ai-sdk/deepseek"\n`;
    init = `const provider = createDeepSeek({
  apiKey: process.env.EMBEDDING_API_KEY
})
const MODEL = provider.embeddingModel(process.env.EMBEDDING_MODEL || ${JSON.stringify(
      config.embeddingModelId,
    )})`;
  } else if (config.embeddingProvider === 'google') {
    imports += `import { createGoogleGenerativeAI } from "@ai-sdk/google"\n`;
    init = `const provider = createGoogleGenerativeAI({
  apiKey: process.env.EMBEDDING_API_KEY
})
const MODEL = provider.textEmbeddingModel(process.env.EMBEDDING_MODEL || ${JSON.stringify(
      config.embeddingModelId,
    )})`;
  } else if (config.embeddingProvider === 'cohere') {
    imports += `import { createCohere } from "@ai-sdk/cohere"\n`;
    init = `const provider = createCohere({
  apiKey: process.env.EMBEDDING_API_KEY
})
const MODEL = provider.embedding(process.env.EMBEDDING_MODEL || ${JSON.stringify(
      config.embeddingModelId,
    )})`;
  } else if (config.embeddingProvider === 'mistral') {
    imports += `import { createMistral } from "@ai-sdk/mistral"\n`;
    init = `const provider = createMistral({
  apiKey: process.env.EMBEDDING_API_KEY
})
const MODEL = provider.embedding(process.env.EMBEDDING_MODEL || ${JSON.stringify(
      config.embeddingModelId,
    )})`;
  } else if (config.embeddingProvider === 'vercel_ai_gateway') {
    imports += `import { createGateway } from "@ai-sdk/gateway"\n`;
    init = `const gateway = createGateway({
  apiKey: process.env.EMBEDDING_API_KEY
})
const MODEL = gateway.embedding(process.env.EMBEDDING_MODEL || ${JSON.stringify(
      config.embeddingModelId,
    )})`;
  } else {
    imports += `import { createOpenAI } from "@ai-sdk/openai"\n`;
    init = `const provider = createOpenAI({
  apiKey: process.env.EMBEDDING_API_KEY
})
const modelName = process.env.EMBEDDING_MODEL || ${JSON.stringify(config.embeddingModelId)};
const MODEL = provider.embedding(modelName.includes("/") ? modelName.split("/")[1] : modelName)`;
  }

  return `${imports}
${init}

export async function embedQuery(text) {
  const { embedding } = await embed({ model: MODEL, value: text })
  return embedding
}
`;
}

/**
 * Keep model discovery in the generated runtime so SDK users can inspect the
 * exact choices available to that deployment without shipping credentials or
 * maintaining a second provider catalog in their application.
 */
function chatModelsSource(config: RagConfig): string {
  const provider = resolveChatProvider(config);
  const model = resolveChatModel(config, provider);

  return `const CHAT_PROVIDER = ${JSON.stringify(provider)};
const CHAT_MODEL = process.env.CHAT_MODEL || ${JSON.stringify(model)};
const GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";
const CACHE_TTL_MS = 15 * 60 * 1000;
let cachedCatalog = null;

function vendorFromModelId(id) {
  return typeof id === "string" && id.includes("/") ? id.split("/", 1)[0] : CHAT_PROVIDER;
}

function configuredFallback() {
  const provider = vendorFromModelId(CHAT_MODEL);
  return {
    configuredProvider: CHAT_PROVIDER,
    configuredModelId: CHAT_MODEL,
    providers: [{ id: provider, name: provider, modelCount: 1 }],
    models: [{ id: CHAT_MODEL, name: CHAT_MODEL, provider }],
    source: "configured",
  };
}

function normalizeGatewayModels(payload) {
  const raw = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
  return raw
    .filter((item) => item && (item.type === "language" || item.type === "chat" || !item.type))
    .map((item) => ({
      id: item.id,
      name: item.name || item.id,
      provider: item.owned_by || item.provider || vendorFromModelId(item.id),
      contextWindow: item.context_window || item.contextWindow,
      maxTokens: item.max_tokens || item.maxTokens,
      tags: Array.isArray(item.tags) ? item.tags : undefined,
      description: item.description,
    }))
    .filter((item) => typeof item.id === "string" && item.id.length > 0);
}

export async function getChatModelCatalog(requestedProvider) {
  if (CHAT_PROVIDER !== "vercel_ai_gateway") {
    const fallback = configuredFallback();
    if (requestedProvider && requestedProvider !== CHAT_PROVIDER && requestedProvider !== fallback.models[0].provider) {
      return { ...fallback, providers: [], models: [] };
    }
    return fallback;
  }

  if (!cachedCatalog || Date.now() - cachedCatalog.at > CACHE_TTL_MS) {
    try {
      const response = await fetch(GATEWAY_MODELS_URL, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error("Gateway model catalog returned " + response.status);
      const models = normalizeGatewayModels(await response.json());
      if (models.length === 0) throw new Error("Gateway model catalog was empty");
      cachedCatalog = { at: Date.now(), models };
    } catch (error) {
      console.warn("[models] Could not refresh AI Gateway catalog:", error instanceof Error ? error.message : String(error));
      return configuredFallback();
    }
  }

  const models = requestedProvider
    ? cachedCatalog.models.filter((item) => item.provider === requestedProvider)
    : cachedCatalog.models;
  const counts = new Map();
  for (const item of models) counts.set(item.provider, (counts.get(item.provider) || 0) + 1);
  return {
    configuredProvider: CHAT_PROVIDER,
    configuredModelId: CHAT_MODEL,
    providers: [...counts.entries()]
      .map(([id, modelCount]) => ({ id, name: id, modelCount }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    models,
    source: "vercel-ai-gateway",
  };
}`;
}

function serverSource(config: RagConfig): string {
  const isAgentServer = config.runtimeProfile === 'assistant';
  const agentTools = ['searchKnowledgeBase', 'getIndexedData']
    .filter((id) => (config.enabledTools ?? []).length === 0 || config.enabledTools?.includes(id))
    .map((id) =>
      id === 'searchKnowledgeBase'
        ? {
            id,
            name: 'Search Knowledge Base',
            description: 'Search indexed Larkup knowledge-base content.',
          }
        : {
            id,
            name: 'Get Indexed Data',
            description: 'List indexed knowledge-base documents.',
          },
    );

  return `import { createServer } from "node:http"
import { embedQuery } from "./embed.mjs"
import * as store from "./store.mjs"
import { getChatModelCatalog } from "./models.mjs"
${isAgentServer ? 'import { widgetScript } from "./widget.mjs"' : ''}
import { handleChat${
    isAgentServer
      ? ', handleAgentChat, handleOpenAIChatCompletions, listAgentCapabilities, listAgentTools, getAgentRuntimeConfiguration, getAgentSandboxStatus'
      : ''
  } } from "./chat.mjs"
import fs from "node:fs"
import path from "node:path"
import * as cheerio from "cheerio"

const PORT = process.env.PORT || 8080
const DEFAULT_TOP_K = Number(process.env.TOP_K || ${config.topK})
const SERVER_PROFILE = ${JSON.stringify(isAgentServer ? 'agent' : 'knowledge')}
const AGENT_TOOLS = ${JSON.stringify(agentTools)}

/* Scoped API-key authentication. */
// SERVER_API_KEYS format: "scope:key,scope:key,..."
// Scopes: retrieval (query/chat), ingest (documents/scrape/media), admin (everything)
// Backward compat: SERVER_API_KEY without scope prefix = admin
const KEY_MAP = new Map()
const rawKeys = process.env.SERVER_API_KEYS || process.env.SERVER_API_KEY || ""
if (rawKeys) {
  for (const entry of rawKeys.split(",").map(s => s.trim()).filter(Boolean)) {
    const colonIdx = entry.indexOf(":")
    if (colonIdx > 0) {
      KEY_MAP.set(entry.slice(colonIdx + 1), entry.slice(0, colonIdx))
    } else {
      // Legacy single key without scope = admin
      KEY_MAP.set(entry, "admin")
    }
  }
}
const AUTH_ENABLED = KEY_MAP.size > 0
console.log('[${
    config.projectName
  }] Auth:', AUTH_ENABLED ? \`\${KEY_MAP.size} scoped key(s) configured\` : 'DISABLED (open access)')

// Endpoint-to-scope access table per ADR-004
const SCOPE_TABLE = {
  retrieval: new Set(["/query", "/chat", "/models", "/agent", "/v1/chat/completions"]),
  ingest: new Set(["/query", "/chat", "/models", "/agent", "/v1/chat/completions", "/documents", "/scrape", "/media"]),
  admin: null, // admin = all endpoints
}

function resolveScope(token) {
  return KEY_MAP.get(token) || null
}

function scopeAllows(scope, pathname) {
  if (!scope) return false
  if (scope === "admin") return true
  if (pathname === "/agent/configuration" || pathname === "/agent/sandbox") return false
  const allowed = SCOPE_TABLE[scope]
  if (!allowed) return false
  // Check if the pathname starts with any allowed prefix
  for (const p of allowed) {
    if (pathname === p || pathname.startsWith(p + "/")) return true
  }
  return false
}

function send(res, status, body) {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  })
  res.end(json)
}

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    return {}
  }
}

const handler = async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {})

  const url = new URL(req.url, \`http://\${req.headers.host}\`)

  if (req.method === "GET" && url.pathname === "/favicon.ico") {
    try {
      const filepath = path.join(process.cwd(), "public", "favicon.ico")
      if (fs.existsSync(filepath)) {
        res.writeHead(200, { "Content-Type": "image/x-icon" })
        return res.end(fs.readFileSync(filepath))
      }
      const rootFilepath = path.join(process.cwd(), "favicon.ico")
      if (fs.existsSync(rootFilepath)) {
        res.writeHead(200, { "Content-Type": "image/x-icon" })
        return res.end(fs.readFileSync(rootFilepath))
      }
    } catch {}
  }

  // Public endpoints: no auth required
  const isPublic = url.pathname === "/" || url.pathname === "/health" || url.pathname === "/readiness" || url.pathname === "/openapi.json" || url.pathname === "/reference"${
    isAgentServer ? ' || url.pathname === "/widget.js"' : ''
  }

  if (AUTH_ENABLED && !isPublic) {
    const auth = req.headers.authorization
    if (!auth) {
      return send(res, 401, { error: "Missing Authorization header. Use 'Authorization: Bearer <key>'." })
    }
    const token = auth.replace(/^Bearer\\s+/i, "").trim()
    const scope = resolveScope(token)
    if (!scope) {
      return send(res, 401, { error: "Invalid API key." })
    }
    if (!scopeAllows(scope, url.pathname)) {
      return send(res, 403, { error: \`Insufficient permissions. Your '\${scope}' key cannot access \${url.pathname}.\` })
    }
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, { ok: true, service: ${JSON.stringify(
      config.projectName,
    )}, type: SERVER_PROFILE === "agent" ? "agent-server" : "knowledge-server", profile: SERVER_PROFILE })
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    })
    return res.end()
  }

${
  isAgentServer
    ? `  if (req.method === "GET" && url.pathname === "/widget.js") {
    res.writeHead(200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    })
    return res.end(widgetScript)
  }
`
    : ''
}

  if (req.method === "GET" && url.pathname === "/readiness") {
    try {
      const t = await store.list({ page: 1, limit: 1 })
      return send(res, 200, { ready: true, vectorStore: "connected", documents: t.total ?? 0 })
    } catch (err) {
      return send(res, 503, { ready: false, vectorStore: "error", error: String(err?.message || err) })
    }
  }

  if (req.method === "GET" && url.pathname === "/models") {
    return send(res, 200, await getChatModelCatalog(url.searchParams.get("provider") || undefined))
  }

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(302, { Location: "/reference", "Cache-Control": "no-store" })
    return res.end()

    res.writeHead(200, { "Content-Type": "text/html" })
    return res.end(\`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>\${${JSON.stringify(config.projectName)}} — Larkup Server</title>
  <link rel="icon" href="/favicon.ico" type="image/x-icon" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F2EDE8;color:#18181b;overflow:hidden;position:relative}
    body::after{content:'';position:fixed;inset:0;pointer-events:none;z-index:0;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.28 0 0 0 0 0.23 0 0 0 0 0.16 0 0 0 0.55 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");background-size:512px 512px;background-repeat:repeat;opacity:0.79;mix-blend-mode:overlay}
    .bg-mesh{position:fixed;inset:0;z-index:0;background-image:radial-gradient(ellipse 55% 45% at 8% 4%,rgba(0,0,0,0.12),transparent 70%),radial-gradient(ellipse 45% 40% at 94% 92%,rgba(220,160,120,0.15),transparent 65%),radial-gradient(ellipse 70% 55% at 50% 50%,rgba(0,0,0,0.05),transparent 80%)}
    .container{position:relative;z-index:1;text-align:center;max-width:800px;padding:2rem;}
    .badge{display:inline-flex;align-items:center;gap:6px;padding:6px 16px;border-radius:100px;font-size:0.75rem;font-weight:500;color:#000;background:rgba(255,255,255,0.8);border:1px solid rgba(0,0,0,0.1);margin-bottom:2rem;backdrop-filter:blur(4px);transition:colors .2s}
    .badge:hover{background:#fff}
    .badge .dot{width:6px;height:6px;border-radius:50%;background:#10b981;box-shadow:0 0 6px rgba(16,185,129,.4);animation:pulse 2s ease-in-out infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    h1{font-size:3.5rem;font-weight:500;letter-spacing:-0.02em;color:#000;margin-bottom:1.5rem;line-height:1.05;}
    .subtitle{font-size:1.125rem;color:#52525b;line-height:1.6;margin-bottom:3rem;max-width:600px;margin-left:auto;margin-right:auto;}
    .actions{display:flex;flex-wrap:wrap;gap:1rem;justify-content:center}
    .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:0.75rem 1.5rem;font-size:0.875rem;font-weight:500;text-decoration:none;transition:all .2s ease;cursor:pointer;border:none;}
    .btn-primary{background:#000000;color:#fff;box-shadow:0 2px 12px rgba(0,0,0,.15)}
    .btn-primary:hover{transform:translateY(-1px);box-shadow:0 4px 20px rgba(0,0,0,.25)}
    .btn-outline{background:transparent;color:#000;border:1px solid rgba(0,0,0,.12);}
    .btn-outline:hover{background:rgba(255,255,255,0.5);border-color:rgba(0,0,0,.2);transform:translateY(-1px);}
    .footer{margin-top:4rem;font-size:.875rem;color:#71717a}
    .footer a{color:#000;text-decoration:underline;text-underline-offset:2px;}
    .footer a:hover{color:#333;}
    .icon{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    @media (max-width: 640px){ h1{font-size:2.5rem;} }
  </style>
</head>
<body>
  <div class="bg-mesh"></div>
  <div class="container">
    <div class="badge"><span class="dot"></span> Server Online</div>
    <h1>\${${JSON.stringify(config.projectName)}}</h1>
    <p class="subtitle">Your Larkup Server is ready.<br/>Powered by <strong style="color:#df9c20">Larkup</strong></p>
    <div class="actions">
      <a href="/reference" class="btn btn-primary">
        <svg class="icon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        API Reference
      </a>
      <a href="https://github.com/Larkup-AI/larkup" target="_blank" rel="noopener" class="btn btn-outline">
        <svg class="icon" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        Larkup Team
      </a>
      <a href="mailto:contact@larkup.de" class="btn btn-outline">
        <svg class="icon" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
        Contact
      </a>
    </div>
    <div class="footer">Built with <a href="https://github.com/Larkup-AI/larkup/buddy-rag" target="_blank" rel="noopener">larkup</a> · v1.0</div>
  </div>
</body>
</html>\`)
  }

  if (req.method === "POST" && url.pathname === "/query") {
    try {
      const { query: q, topK } = await readBody(req)
      if (!q || typeof q !== "string") {
        return send(res, 400, { error: "Body must include a 'query' string." })
      }
      const vector = await embedQuery(q)
      const hits = await store.query(vector, Number(topK) || DEFAULT_TOP_K)
      return send(res, 200, { query: q, hits })
    } catch (err) {
      return send(res, 500, { error: String(err?.message || err) })
    }
  }

${
  isAgentServer
    ? `  if (req.method === "GET" && url.pathname === "/agent") {
    return send(res, 200, {
      name: ${JSON.stringify(config.projectName)},
      agentId: ${JSON.stringify(config.projectName)},
      profile: "agent",
      tools: await listAgentTools(),
    })
  }

  if (req.method === "GET" && url.pathname === "/agent/tools") {
    return send(res, 200, { tools: await listAgentTools() })
  }

  if (req.method === "GET" && url.pathname === "/agent/capabilities") {
    return send(res, 200, { capabilities: await listAgentCapabilities() })
  }

  if (req.method === "GET" && url.pathname === "/agent/configuration") {
    return send(res, 200, getAgentRuntimeConfiguration())
  }

  if (req.method === "GET" && url.pathname === "/agent/sandbox") {
    return send(res, 200, await getAgentSandboxStatus())
  }

  if (req.method === "POST" && (url.pathname === "/chat" || url.pathname === "/agent/chat")) {
    return handleAgentChat(req, res)
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    return handleOpenAIChatCompletions(req, res)
  }
`
    : `  if (req.method === "POST" && url.pathname === "/chat") {
    return handleChat(req, res)
  }
`
}

  if (req.method === "GET" && url.pathname === "/documents") {
    try {
      const page  = Math.max(1, parseInt(url.searchParams.get("page")  || "1",  10) || 1)
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10) || 20))
      const result = await store.list({ page, limit })
      return send(res, 200, result)
    } catch (err) {
      return send(res, 500, { error: String(err?.message || err) })
    }
  }

  if (req.method === "GET" && url.pathname.match(/^\\/documents\\/[^/]+$/) && !url.pathname.endsWith("/documents")) {
    try {
      const id = url.pathname.split("/").pop()
      const doc = await store.get(id)
      if (!doc) return send(res, 404, { error: "Document not found" })
      return send(res, 200, doc)
    } catch (err) {
      return send(res, 500, { error: String(err?.message || err) })
    }
  }

  if (req.method === "POST" && url.pathname === "/documents") {
    try {
      const doc = await readBody(req)
      if (!doc.text) return send(res, 400, { error: "Missing text" })
      const vector = await embedQuery(doc.text)
      const id = doc.id || Math.random().toString(36).slice(2)
      await store.add([{ id, vector, text: doc.text, title: doc.title || "Untitled", url: doc.url || "", documentId: doc.documentId || id }])
      return send(res, 200, { success: true, id })
    } catch (err) {
      console.error("[POST /documents] Error:", err)
      return send(res, 500, { error: String(err?.message || err) })
    }
  }

  if (req.method === "PUT" && url.pathname.startsWith("/documents/")) {
    try {
      const id = url.pathname.split("/").pop()
      const doc = await readBody(req)
      if (!doc.text) return send(res, 400, { error: "Missing text" })
      const vector = await embedQuery(doc.text)
      await store.update(id, { id, vector, text: doc.text, title: doc.title || "Untitled", url: doc.url, documentId: doc.documentId || id })
      return send(res, 200, { success: true })
    } catch (err) {
      return send(res, 500, { error: String(err?.message || err) })
    }
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/documents/")) {
    try {
      const id = url.pathname.split("/").pop()
      await store.remove(id)
      return send(res, 200, { success: true })
    } catch (err) {
      return send(res, 500, { error: String(err?.message || err) })
    }
  }

  if (req.method === "POST" && url.pathname === "/scrape") {
    try {
      const { url: targetUrl } = await readBody(req)
      if (!targetUrl || typeof targetUrl !== "string") {
        return send(res, 400, { error: "Body must include a 'url' string." })
      }
      const fetchRes = await fetch(targetUrl)
      if (!fetchRes.ok) return send(res, 502, { error: \`Failed to fetch \${targetUrl}: \${fetchRes.status}\` })
      const html = await fetchRes.text()
      const $ = cheerio.load(html)
      $("script, style, nav, footer, header, iframe, noscript").remove()
      const rawText = $("body").text().replace(/\\s+/g, " ").trim()
      if (!rawText) return send(res, 422, { error: "No text content extracted from URL." })

      const title = $("title").text().trim() || new URL(targetUrl).hostname
      const CHUNK_SIZE = 1000
      const chunks = []
      for (let i = 0; i < rawText.length; i += CHUNK_SIZE) {
        chunks.push(rawText.slice(i, i + CHUNK_SIZE))
      }

      const documentId = Math.random().toString(36).slice(2)
      for (const [idx, chunk] of chunks.entries()) {
        const id = \`\${documentId}-\${idx}\`
        const vector = await embedQuery(chunk)
        await store.add([{ id, vector, text: chunk, title: \`\${title} (part \${idx + 1})\`, url: targetUrl || "", documentId }])
      }

      return send(res, 200, { success: true, documentId, chunks: chunks.length })
    } catch (err) {
      return send(res, 500, { error: String(err?.message || err) })
    }
  }

  if (req.method === "GET" && url.pathname === "/corpus/summary") {
    try {
      const all = await store.list({ page: 1, limit: 100000 })
      const docs = all.documents || []
      const bySource = {}
      const byStatus = {}
      let totalChars = 0
      for (const d of docs) {
        const src = d.source || "unknown"
        bySource[src] = (bySource[src] || 0) + 1
        const st = d.status || "indexed"
        byStatus[st] = (byStatus[st] || 0) + 1
        totalChars += (d.text || "").length
      }
      return send(res, 200, {
        totalDocuments: all.total,
        bySource,
        byStatus,
        totalCharacters: totalChars
      })
    } catch (err) {
      return send(res, 500, { error: String(err?.message || err) })
    }
  }

  if (req.method === "POST" && url.pathname === "/corpus") {
    try {
      const { filter, limit: reqLimit, offset: reqOffset, includeContent } = await readBody(req)
      const pageSize = Math.min(Math.max(reqLimit || 200, 1), 1000)
      const page = Math.max(1, Math.floor((reqOffset || 0) / pageSize) + 1)
      const result = await store.list({ page, limit: pageSize })
      let docs = result.documents || []

      // Apply optional filters
      if (filter) {
        if (filter.source) docs = docs.filter(d => d.source === filter.source)
        if (filter.titleContains) {
          const needle = filter.titleContains.toLowerCase()
          docs = docs.filter(d => (d.title || "").toLowerCase().includes(needle))
        }
      }

      const mapped = docs.map(d => {
        const entry = { id: d.id, title: d.title, url: d.url, documentId: d.documentId, charCount: (d.text || "").length }
        if (includeContent) entry.content = (d.text || "").slice(0, 2000)
        return entry
      })
      return send(res, 200, { documents: mapped, total: result.total, page, limit: pageSize })
    } catch (err) {
      return send(res, 500, { error: String(err?.message || err) })
    }
  }

  if (req.method === "POST" && url.pathname === "/corpus/export") {
    try {
      const { format } = await readBody(req)
      const all = await store.list({ page: 1, limit: 100000 })
      const docs = all.documents || []

      if (format === "jsonl") {
        const lines = docs.map(d => JSON.stringify({
          id: d.id, title: d.title, url: d.url || "",
          documentId: d.documentId, text: (d.text || "").slice(0, 1000)
        }))
        res.writeHead(200, { "Content-Type": "application/x-ndjson", "Access-Control-Allow-Origin": "*" })
        return res.end(lines.join("\\n"))
      }

      // Default: CSV
      const header = "id,title,url,documentId,charCount,content"
      const csvEscape = (v) => {
        const s = String(v || "")
        return s.includes(",") || s.includes('"') || s.includes("\\n") ? '"' + s.replace(/"/g, '""') + '"' : s
      }
      const rows = docs.map(d => [
        d.id, d.title, d.url || "", d.documentId,
        (d.text || "").length,
        (d.text || "").slice(0, 1000).replace(/\\n/g, " ")
      ].map(csvEscape).join(","))
      res.writeHead(200, { "Content-Type": "text/csv", "Access-Control-Allow-Origin": "*" })
      return res.end([header, ...rows].join("\\n"))
    } catch (err) {
      return send(res, 500, { error: String(err?.message || err) })
    }
  }

  if (req.method === "GET" && url.pathname === "/openapi.json") {
    return send(res, 200, {
      openapi: "3.1.0",
      info: {
        title: SERVER_PROFILE === "agent" ? "Larkup Agent Server" : "Larkup Knowledge Server",
        version: "1.0.0",
        description: SERVER_PROFILE === "agent"
          ? "Knowledge-base operations plus an AI SDK-compatible Agent API."
          : "Knowledge-base retrieval and content-management API.",
      },
      security: [{ bearerAuth: [] }],
      tags: [
        { name: "Knowledge", description: "Knowledge base retrieval and management." },
        ...(SERVER_PROFILE === "agent"
          ? [{ name: "Agent", description: "Agent chat streaming and loaded tools." }]
          : []),
      ],
      paths: {
        "/query": {
          post: {
            summary: "Query the RAG knowledge base",
            tags: ["Knowledge"],
            security: [{ bearerAuth: [] }],
            requestBody: {
              content: { "application/json": { schema: { type: "object", properties: { query: { type: "string" }, topK: { type: "number" } } } } }
            },
            responses: { "200": { description: "Successful response" } }
          }
        },
        "/chat": {
          post: {
            summary: SERVER_PROFILE === "agent" ? "Stream an Agent chat response" : "Stream a retrieval-grounded chat response",
            tags: [SERVER_PROFILE === "agent" ? "Agent" : "Knowledge"],
            security: [{ bearerAuth: [] }],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["messages"],
                    properties: {
                      messages: {
                        type: "array",
                        items: {
                          type: "object",
                          required: ["role", "content"],
                          properties: {
                            role: { type: "string", enum: ["user", "assistant", "system"] },
                            content: { type: "string" }
                          }
                        }
                      },
                      topK: { type: "integer", minimum: 1 },
                      provider: { type: "string", description: "Configured chat runtime provider. Optional; must match this deployment." },
                      modelId: { type: "string", description: "Model ID to use for this request. Gateway runtimes accept any listed Gateway language model; direct providers accept their own model IDs." }
                    }
                  }
                }
              }
            },
            responses: {
              "200": {
                description: SERVER_PROFILE === "agent"
                  ? "AI SDK UI message stream"
                  : "Server-sent events containing text-delta and done events",
                content: { "text/event-stream": {} }
              }
            }
          }
        },
        "/documents": {
          get: {
            summary: "List documents (paginated)",
            tags: ["Knowledge"],
            security: [{ bearerAuth: [] }],
            parameters: [
              { name: "page",  in: "query", required: false, schema: { type: "integer", default: 1,  minimum: 1 }, description: "Page number (1-indexed)" },
              { name: "limit", in: "query", required: false, schema: { type: "integer", default: 20, minimum: 1, maximum: 100 }, description: "Items per page" }
            ],
            responses: {
              "200": {
                description: "Paginated list of documents",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        documents:  { type: "array",   items: { type: "object" } },
                        total:      { type: "integer", description: "Total number of documents" },
                        page:       { type: "integer", description: "Current page" },
                        limit:      { type: "integer", description: "Items per page" },
                        totalPages: { type: "integer", description: "Total number of pages" }
                      }
                    }
                  }
                }
              }
            }
          },
          post: {
            summary: "Add a new document",
            tags: ["Knowledge"],
            security: [{ bearerAuth: [] }],
            requestBody: {
              content: { "application/json": { schema: { type: "object", properties: { text: { type: "string" }, title: { type: "string" }, url: { type: "string" }, documentId: { type: "string" } } } } }
            },
            responses: { "200": { description: "Successful response" } }
          }
        },
        "/documents/{id}": {
          get: {
            summary: "Get a single document by ID",
            tags: ["Knowledge"],
            security: [{ bearerAuth: [] }],
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
            responses: {
              "200": { description: "Document object" },
              "404": { description: "Document not found" }
            }
          },
          put: {
            summary: "Update a document",
            tags: ["Knowledge"],
            security: [{ bearerAuth: [] }],
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
            requestBody: {
              content: { "application/json": { schema: { type: "object", properties: { text: { type: "string" }, title: { type: "string" }, url: { type: "string" }, documentId: { type: "string" } } } } }
            },
            responses: { "200": { description: "Successful response" } }
          },
          delete: {
            summary: "Delete a document",
            tags: ["Knowledge"],
            security: [{ bearerAuth: [] }],
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
            responses: { "200": { description: "Successful response" } }
          }
        },
        "/scrape": {
          post: {
            summary: "Scrape a URL and ingest into the corpus",
            tags: ["Knowledge"],
            security: [{ bearerAuth: [] }],
            requestBody: {
              content: { "application/json": { schema: { type: "object", required: ["url"], properties: { url: { type: "string", description: "URL to scrape" } } } } }
            },
            responses: {
              "200": { description: "Scrape successful", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, documentId: { type: "string" }, chunks: { type: "integer" } } } } } },
              "502": { description: "Failed to fetch the target URL" }
            }
          }
        },
        "/health": {
          get: {
            summary: "Health check",
            tags: ["Knowledge"],
            responses: { "200": { description: "OK" } }
          }
        },
        "/models": {
          get: {
            summary: "List chat providers and models available to this runtime",
            tags: ["Knowledge"],
            security: [{ bearerAuth: [] }],
            parameters: [{ name: "provider", in: "query", required: false, schema: { type: "string" }, description: "Filter Gateway models by provider." }],
            responses: { "200": { description: "Chat provider and model catalog" } }
          }
        },
        "/readiness": {
          get: {
            summary: "Check knowledge-store readiness",
            tags: ["Knowledge"],
            responses: { "200": { description: "Knowledge store is connected" }, "503": { description: "Knowledge store is unavailable" } }
          }
        },
        "/corpus/summary": {
          get: {
            summary: "Get corpus summary statistics",
            tags: ["Knowledge"],
            security: [{ bearerAuth: [] }],
            responses: {
              "200": {
                description: "Corpus summary with counts by source and status",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        totalDocuments: { type: "integer" },
                        bySource: { type: "object" },
                        byStatus: { type: "object" },
                        totalCharacters: { type: "integer" }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        "/corpus": {
          post: {
            summary: "Get corpus documents with optional filtering",
            tags: ["Knowledge"],
            security: [{ bearerAuth: [] }],
            requestBody: {
              content: { "application/json": { schema: { type: "object", properties: {
                filter: { type: "object", properties: { source: { type: "string" }, titleContains: { type: "string" } } },
                limit: { type: "integer", default: 200 },
                offset: { type: "integer", default: 0 },
                includeContent: { type: "boolean", default: false }
              } } } }
            },
            responses: { "200": { description: "Paginated list of corpus documents" } }
          }
        },
        "/corpus/export": {
          post: {
            summary: "Export full corpus as CSV or JSONL",
            tags: ["Knowledge"],
            security: [{ bearerAuth: [] }],
            requestBody: {
              content: { "application/json": { schema: { type: "object", properties: { format: { type: "string", enum: ["csv", "jsonl"], default: "csv" } } } } }
            },
            responses: { "200": { description: "Corpus data in requested format" } }
          }
        },
        ...(SERVER_PROFILE === "agent" ? {
          "/agent": {
            get: {
              summary: "Get Agent Runtime information",
              tags: ["Agent"],
              security: [{ bearerAuth: [] }],
              responses: { "200": { description: "Agent name, profile, and loaded tools" } },
            },
          },
          "/agent/tools": {
            get: {
              summary: "List tools loaded by the Agent",
              tags: ["Agent"],
              security: [{ bearerAuth: [] }],
              responses: { "200": { description: "Available Agent tool manifests" } },
            },
          },
          "/agent/capabilities": {
            get: {
              summary: "List grouped Agent capabilities",
              tags: ["Agent"],
              security: [{ bearerAuth: [] }],
              responses: { "200": { description: "Built-in, skills, sandbox, MCP, and plugin capability groups" } },
            },
          },
            "/agent/configuration": {
            get: {
              summary: "Get saved Agent prompt and skills",
              tags: ["Agent"],
              security: [{ bearerAuth: [] }],
              responses: { "200": { description: "Saved system prompt and enabled skill metadata; requires an admin key when auth is configured" } },
            },
            "/agent/sandbox": {
              get: {
                summary: "Check the configured Agent sandbox environment",
                responses: { "200": { description: "Sanitized sandbox health status" } },
              },
            },
          },
          "/agent/chat": {
            post: {
              summary: "Stream an Agent response using the AI SDK UI message protocol",
              tags: ["Agent"],
              security: [{ bearerAuth: [] }],
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      required: ["messages"],
                      properties: { messages: { type: "array", items: { type: "object" } } },
                    },
                  },
                },
              },
              responses: { "200": { description: "AI SDK UI message stream", content: { "text/event-stream": {} } } },
            },
          },
          "/v1/chat/completions": {
            post: {
              summary: "OpenAI-compatible Agent chat completions",
              tags: ["Agent"],
              security: [{ bearerAuth: [] }],
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      required: ["messages"],
                      properties: {
                        model: { type: "string" },
                        stream: { type: "boolean", default: true },
                        messages: { type: "array", items: { type: "object" } },
                      },
                    },
                  },
                },
              },
              responses: { "200": { description: "OpenAI chat completion or SSE completion stream" } },
            },
          },
        } : {})
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer"
          }
        }
      }
    })
  }

  if (req.method === "GET" && url.pathname === "/reference") {
    const defaultToken = process.env.SERVER_API_KEY || ""
    res.writeHead(200, { "Content-Type": "text/html" })
    return res.end(\`
      <!DOCTYPE html>
      <html>
        <head>
          <title>API Reference</title>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <link rel="icon" href="/favicon.ico" type="image/x-icon" />
          <style>
            :root {
              --scalar-color-1: #000000;
              --scalar-color-2: #333333;
              --scalar-color-3: #666666;
              --scalar-color-accent: #000000;
              --scalar-background-1: #ffffff;
              --scalar-background-2: #fafafa;
              --scalar-background-3: #f5f5f5;
              --scalar-background-accent: #f0f0f0;
            }
            .dark-mode {
              --scalar-color-1: #ffffff;
              --scalar-color-2: #cccccc;
              --scalar-color-3: #999999;
              --scalar-color-accent: #ffffff;
              --scalar-background-1: #000000;
              --scalar-background-2: #111111;
              --scalar-background-3: #222222;
              --scalar-background-accent: #333333;
            }
          </style>
        </head>
        <body>
          <script id="api-reference" data-url="/openapi.json"></script>
          <script>
            const configuration = {
              "theme": "default",
              "hideClientButton": false,
              "showSidebar": true,
              "showDeveloperTools": "localhost",
              "showToolbar": "localhost",
              "operationTitleSource": "summary",
              "persistAuth": true,
              "telemetry": true,
              "externalUrls": {
                "dashboardUrl": "https://dashboard.scalar.com",
                "registryUrl": "https://registry.scalar.com",
                "proxyUrl": "https://proxy.scalar.com",
                "apiBaseUrl": "https://api.scalar.com"
              },
              "default": false,
              "layout": "modern",
              "isEditable": false,
              "isLoading": false,
              "hideModels": false,
              "documentDownloadType": "both",
              "hideTestRequestButton": false,
              "hideSearch": false,
              "showOperationId": false,
              "hideDarkModeToggle": false,
              "withDefaultFonts": true,
              "defaultOpenFirstTag": true,
              "defaultOpenAllTags": false,
              "expandAllModelSections": false,
              "expandAllResponses": false,
              "orderSchemaPropertiesBy": "alpha",
              "orderRequiredPropertiesFirst": true,
              "_integration": "html",
              "modelsSectionLabel": "Models",
              "slug": "api-1",
              "title": "API #1",
              "authentication": {
                "preferredSecurityScheme": "bearerAuth",
                "http": {
                  "basic": { "username": "", "password": "" },
                  "bearer": { "token": "\${defaultToken}" }
                }
              }
            };
            document.getElementById('api-reference').dataset.configuration = JSON.stringify(configuration);
          </script>
          <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
        </body>
      </html>
    \`)
  }

  return send(res, 404, { error: "Not found" })
}

const IS_SERVERLESS = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME

if (!IS_SERVERLESS) {
  const server = createServer(handler)
  server.listen(PORT, () => {
    console.log(\`Server listening on port \${PORT}\`)
  })
}

export default handler;
`;
}

function demoSource(): string {
  return `const BASE = process.env.RAG_SERVER_URL || "http://localhost:8080"

const question = process.argv.slice(2).join(" ") || "What is this corpus about?"

const res = await fetch(\`\${BASE}/query\`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: question }),
})

const data = await res.json()
if (!res.ok) {
  console.error("Error:", data.error)
  process.exit(1)
}

console.log(\`\\nQuery: \${data.query}\\n\`)
for (const [i, hit] of data.hits.entries()) {
  console.log(\`#\${i + 1} [\${hit.score.toFixed(3)}] \${hit.title}\`)
  if (hit.url) console.log(\`   \${hit.url}\`)
  console.log(\`   \${hit.text.slice(0, 160).replace(/\\n/g, " ")}...\\n\`)
}
`;
}

function widgetSource(config: RagConfig): string {
  const settings = {
    title: config.widget?.title || 'Ask us anything',
    welcomeMessage: config.widget?.welcomeMessage || 'Hi! How can I help?',
    placeholder: config.widget?.placeholder || 'Type a message…',
    primaryColor: config.widget?.primaryColor || '#111827',
    position: config.widget?.position || 'bottom-right',
    darkMode: Boolean(config.widget?.darkMode),
    logoUrl: config.widget?.logoUrl || '',
  };
  const browserSource = `(() => {
  const defaults = ${JSON.stringify(settings)};
  const script = document.currentScript || document.querySelector('script[data-larkup-widget]') || document.querySelector('script[src*="/widget.js"]');
  const data = script?.dataset || {};
  const host = String(data.host || new URL(script?.src || location.href, location.href).origin).replace(/\\/+$/, '');
  const config = { ...defaults, title: data.title || defaults.title, welcomeMessage: data.welcomeMessage || defaults.welcomeMessage, placeholder: data.placeholder || defaults.placeholder, primaryColor: data.primaryColor || defaults.primaryColor, position: data.position || defaults.position, darkMode: data.theme ? data.theme === 'dark' : defaults.darkMode, logoUrl: data.logoUrl || defaults.logoUrl };
  const mount = document.createElement('div'); mount.dataset.larkupWidget = ''; if (data.class) mount.className = data.class; document.body.appendChild(mount);
  const root = mount.attachShadow({ mode: 'open' });
  root.innerHTML = '<style>:host{all:initial}*{box-sizing:border-box}.w{--a:' + config.primaryColor + ';position:fixed;bottom:20px;z-index:2147483000;font:14px/1.45 ui-sans-serif,system-ui;color:#17191e}.right{right:20px}.left{left:20px}.p{width:min(390px,calc(100vw - 32px));height:min(620px,calc(100vh - 110px));display:none;flex-direction:column;overflow:hidden;background:#fff;border:1px solid #e1e3e8;border-radius:18px;box-shadow:0 20px 60px #11182738}.open .p{display:flex}.dark .p{background:#17191e;border-color:#343946;color:#f4f4f5;box-shadow:0 20px 60px #0009}.h{display:flex;gap:10px;align-items:center;padding:15px 16px;border-bottom:1px solid #e1e3e8}.dark .h{border-color:#343946}.d{width:9px;height:9px;border-radius:99px;background:var(--a)}strong{flex:1}.x,.b,.s{border:0;cursor:pointer}.x{background:transparent;color:inherit;font-size:20px}.m{flex:1;overflow:auto;display:flex;flex-direction:column;gap:10px;padding:16px}.a,.u,.empty{max-width:86%;padding:10px 12px;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere}.a,.empty{align-self:flex-start;background:#f3f4f6}.dark .a,.dark .empty{background:#292d36}.u{align-self:flex-end;background:var(--a);color:#fff;border-bottom-right-radius:4px}.f{display:flex;gap:8px;padding:12px;border-top:1px solid #e1e3e8}.dark .f{border-color:#343946}textarea{flex:1;min-height:42px;resize:none;border:1px solid #d8dbe2;border-radius:12px;padding:10px;background:transparent;color:inherit;font:inherit}.s{width:42px;border-radius:12px;background:var(--a);color:#fff}.b{display:flex;align-items:center;justify-content:center;margin:12px 0 0 auto;width:56px;height:56px;border-radius:99px;background:var(--a);color:#fff;font-size:22px;box-shadow:0 10px 25px #11182740}.left .b{margin-left:0}.err{color:#dc2626}.dark .err{color:#fca5a5}.cb{background:#1e1e1e;color:#d4d4d4;border-radius:8px;overflow:hidden;margin:8px 0;font-family:monospace;font-size:13px;white-space:normal}.cb-h{display:flex;justify-content:space-between;background:#2d2d2d;padding:4px 8px;font-size:11px;color:#a0a0a0}.cb-h button{background:none;border:none;color:inherit;cursor:pointer;padding:0}.cb pre{margin:0;padding:8px;overflow-x:auto;white-space:pre}code{font-family:monospace;background:#0002;padding:2px 4px;border-radius:4px}a{color:var(--a)}@keyframes pulse{0%,100%{opacity:.5}50%{opacity:1}}</style><div class="w ' + (config.position === 'bottom-left' ? 'left' : 'right') + (config.darkMode ? ' dark' : '') + '"><section class="p" role="dialog"><header class="h"><i class="d"></i><strong></strong><button class="x" aria-label="Close chat">×</button></header><main class="m"><div class="empty"></div></main><form class="f"><textarea rows="1"></textarea><button class="s" aria-label="Send">↑</button></form></section><button class="b" aria-label="Open chat"></button></div>';
  const shell = root.querySelector('.w'), panel = root.querySelector('.p'), button = root.querySelector('.b'), close = root.querySelector('.x'), list = root.querySelector('.m'), empty = root.querySelector('.empty'), input = root.querySelector('textarea'), form = root.querySelector('form');
  root.querySelector('strong').textContent = config.title; empty.textContent = config.welcomeMessage; input.placeholder = config.placeholder;
  const iconNormal = config.logoUrl ? '<img src="' + config.logoUrl + '" style="width:28px;height:28px;border-radius:99px;object-fit:cover">' : '◌';
  button.innerHTML = iconNormal;
  const toggle = (open) => { shell.classList.toggle('open', open); button.innerHTML = open ? '×' : iconNormal; }; button.onclick = () => toggle(!shell.classList.contains('open')); close.onclick = () => toggle(false);
  const add = (name, text) => { const el = document.createElement('div'); el.className = name; el.innerHTML = text; list.appendChild(el); list.scrollTop = list.scrollHeight; return el; };
  const text = (line) => { try { if (line.startsWith('0:')) { const value = JSON.parse(line.slice(2)); return typeof value === 'string' ? value : ''; } if (!line.startsWith('data:')) return ''; const value = JSON.parse(line.slice(5)); return value?.type === 'text-delta' ? (value.delta || value.text || '') : ''; } catch { return ''; } };
  const parseMD = (str) => { return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\\\`\\\`\\\`(\\w*)\\n([\\s\\S]*?)\\\`\\\`\\\`/g, '<div class="cb"><div class="cb-h"><span>$1</span><button type="button" onclick="navigator.clipboard.writeText(this.parentElement.nextElementSibling.textContent);this.textContent=\\'Copied!\\';setTimeout(()=>this.textContent=\\'Copy\\',2000)">Copy</button></div><pre><code>$2</code></pre></div>').replace(/\\\`([^\`]+)\\\`/g, '<code>$1</code>').replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>').replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank">$1</a>'); };
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } };
  form.onsubmit = async (event) => { event.preventDefault(); const question = input.value.trim(); if (!question) return; empty.remove(); add('u', parseMD(question)); input.value = ''; const answer = add('a', '<span style="animation:pulse 1s infinite">Thinking...</span>'); try { const response = await fetch(host + '/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(data.apiKey ? { Authorization: 'Bearer ' + data.apiKey } : {}) }, body: JSON.stringify({ messages: [{ role: 'user', content: question }] }) }); if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Could not reach the assistant.'); const reader = response.body?.getReader(), decoder = new TextDecoder(); if (!reader) return; let buffer = ''; let fullText = ''; while (true) { const chunk = await reader.read(); buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done }); const lines = buffer.split(/\\r?\\n/); buffer = lines.pop() || ''; for (const line of lines) { const t = text(line); if (t) { fullText += t; answer.innerHTML = parseMD(fullText); list.scrollTop = list.scrollHeight; } } if (chunk.done) break; } const t = text(buffer); if (t) { fullText += t; answer.innerHTML = parseMD(fullText); list.scrollTop = list.scrollHeight; } } catch (error) { answer.classList.add('err'); answer.textContent = error instanceof Error ? error.message : 'Could not reach the assistant.'; } };
  window.LarkupWidget = { destroy: () => mount.remove() };
})();`;
  return `export const widgetScript = ${JSON.stringify(browserSource)};\n`;
}

function dockerfile(): string {
  return `FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.mjs"]
`;
}

function dockerignore(): string {
  return `node_modules
npm-debug.log
.env
.git
.DS_Store
`;
}

function dockerCompose(projectName: string, usesLocalLance: boolean): string {
  const volume = usesLocalLance
    ? `    volumes:
      - larkup_data:/app/.larkup
`
    : '';
  const volumes = usesLocalLance ? `\nvolumes:\n  larkup_data:\n    driver: local\n` : '';
  return `services:
  ${projectName}:
    build: .
    container_name: ${projectName}
    restart: unless-stopped
    ports:
      - "8080:8080"
    env_file:
      - .env
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s
${volume}${volumes}`;
}

function vercelJson(): string {
  return `{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "builds": [{ "src": "server.mjs", "use": "@vercel/node" }],
  "routes": [
    { "handle": "filesystem" },
    { "src": "/(.*)", "dest": "server.mjs" }
  ]
}
`;
}

function envExample(server: GeneratedServer): string {
  return server.envVars
    .map((e) => `# ${e.help}${e.required ? '' : ' (optional)'}\n${e.key}=`)
    .join('\n');
}

function readme(config: RagConfig, server: GeneratedServer): string {
  const store = getVectorStore(config.vectorStore);
  const isAgentServer = config.runtimeProfile === 'assistant';
  const deps = Object.entries(server.dependencies)
    .map(([k, v]) => `- \`${k}@${v}\``)
    .join('\n');
  return `# ${config.projectName}

A Larkup **${isAgentServer ? 'Agent Server' : 'Knowledge Server'}** — ${
    isAgentServer
      ? 'AI SDK-compatible agent plus RAG knowledge base.'
      : 'lightweight RAG retrieval API.'
  }

- **Vector store:** ${store.label}
- **Embedding model:** ${config.embeddingModelId}
- **Index type:** ${config.indexType}
- **Default top-k:** ${config.topK}

## Dependencies
${deps}

## Run locally
\`\`\`bash
npm install
cp .env.example .env
node server.mjs
\`\`\`

Then query it:
\`\`\`bash
node demo.mjs "your question here"
# or
curl -X POST http://localhost:8080/query \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <your-retrieval-key>" \\
  -d '{"query":"your question","topK":${config.topK}}'
\`\`\`

## Authentication

Set \`SERVER_API_KEYS\` with scoped keys:
\`\`\`bash
SERVER_API_KEYS=retrieval:rk_your_key,ingest:ik_your_key,admin:ak_your_key
\`\`\`

| Scope | Can do |
|-------|--------|
| \`retrieval\` | Query, chat |
| \`ingest\` | Query, chat, add/update/delete documents, scrape, media |
| \`admin\` | Everything including corpus export |

A single key without a scope prefix is treated as \`admin\` for backward compatibility.

## Deploy

### Docker / VPS
\`\`\`bash
docker compose up -d --build
\`\`\`

Data persists in a Docker named volume (\`larkup_data\`).

### Vercel
\`\`\`bash
vercel deploy
\`\`\`

> **Important:** Vercel uses ephemeral storage. You must configure S3-compatible
> (\`LANCEDB_MODE=s3\`) or LanceDB Cloud (\`LANCEDB_MODE=cloud\`) storage for
> production. Local LanceDB data will not persist between invocations.

## API
- \`GET  /health\`           → \`{ ok: true, type: "knowledge-server" }\`
- \`GET  /readiness\`        → \`{ ready: true, vectorStore: "connected" }\`
- \`GET  /reference\`        → Scalar API docs UI
- \`GET  /models\`           → available chat providers and models
- \`POST /query\`            → \`{ query, hits: [...] }\` (retrieval scope)
- \`POST /chat\`             → ${
    isAgentServer ? 'AI SDK UI message stream (retrieval scope)' : 'SSE stream (retrieval scope)'
  }
${
  isAgentServer
    ? `- \`GET  /agent\`            → Agent Runtime details
- \`GET  /agent/tools\`      → loaded Agent tools
- \`GET  /agent/capabilities\` → grouped Agent capabilities
- \`GET  /agent/configuration\` → saved prompt and skills (admin scope)
- \`GET  /agent/sandbox\` → sandbox provider and readiness (admin scope)
- \`POST /agent/chat\`       → AI SDK UI message stream
- \`POST /v1/chat/completions\` → OpenAI-compatible Agent chat\n`
    : ''
}
- \`GET  /documents\`        → list documents (ingest scope)
- \`GET  /documents/:id\`    → get a document (ingest scope)
- \`POST /documents\`        → add a document (ingest scope)
- \`PUT  /documents/:id\`    → update a document (ingest scope)
- \`DELETE /documents/:id\`  → delete a document (ingest scope)
- \`POST /scrape\`           → scrape and ingest URL (ingest scope)
- \`GET  /corpus/summary\`   → corpus stats (admin scope)
- \`POST /corpus\`           → corpus documents (admin scope)
- \`POST /corpus/export\`    → export as CSV/JSONL (admin scope)
`;
}

export function generateServer(config: RagConfig): GeneratedServer {
  const store = getVectorStore(config.vectorStore);
  const model = getEmbeddingModel(config.embeddingModelId);
  const usesLocalLance =
    config.vectorStore === 'lancedb' && (config.storeConfig.mode ?? 'local') === 'local';

  const dependencies: Record<string, string> = {
    ai: AI_SDK_VERSION,
    cheerio: '^1.0.0',
    ...store.serverDependencies,
  };
  if (config.runtimeProfile === 'assistant') {
    dependencies.zod = '^4.4.3';
    dependencies['@ai-sdk/mcp'] = '2.0.26';
    dependencies['@larkup/sandbox'] = '^0.1.2';
    for (const plugin of config.agentPlugins ?? []) {
      if (
        plugin.version &&
        /^(?:@[-a-z0-9~][-_a-z0-9~]*\/)?[-a-z0-9~][-_a-z0-9~]*$/i.test(plugin.packageName)
      ) {
        dependencies[plugin.packageName] = plugin.version;
      }
    }
  }

  if (config.embeddingModelId.startsWith('custom:')) {
    dependencies['@ai-sdk/openai-compatible'] =
      AI_SDK_PROVIDER_VERSIONS['@ai-sdk/openai-compatible'];
  } else if (config.embeddingProvider === 'deepseek') {
    dependencies['@ai-sdk/deepseek'] = AI_SDK_PROVIDER_VERSIONS['@ai-sdk/deepseek'];
  } else if (config.embeddingProvider === 'google') {
    dependencies['@ai-sdk/google'] = AI_SDK_PROVIDER_VERSIONS['@ai-sdk/google'];
  } else if (config.embeddingProvider === 'cohere') {
    dependencies['@ai-sdk/cohere'] = AI_SDK_PROVIDER_VERSIONS['@ai-sdk/cohere'];
  } else if (config.embeddingProvider === 'mistral') {
    dependencies['@ai-sdk/mistral'] = AI_SDK_PROVIDER_VERSIONS['@ai-sdk/mistral'];
  } else if (config.embeddingProvider === 'vercel_ai_gateway') {
    dependencies['@ai-sdk/gateway'] = AI_SDK_PROVIDER_VERSIONS['@ai-sdk/gateway'];
  } else if (config.embeddingProvider === 'jina') {
    dependencies['@ai-sdk/openai'] = AI_SDK_PROVIDER_VERSIONS['@ai-sdk/openai'];
  } else {
    dependencies['@ai-sdk/openai'] = AI_SDK_PROVIDER_VERSIONS['@ai-sdk/openai'];
  }
  const chatProvider = resolveChatProvider(config);
  const chatModel = resolveChatModel(config, chatProvider);
  addChatProviderDependency(dependencies, chatProvider);

  const envVars: GeneratedServer['envVars'] = [
    {
      key: 'EMBEDDING_API_KEY',
      required: true,
      help: 'API key used to embed incoming queries.',
    },
    {
      key: 'PORT',
      required: false,
      help: 'Port to listen on (default 8080).',
    },
    {
      key: 'SERVER_API_KEYS',
      required: false,
      help: "Scoped API keys. Format: 'scope:key,scope:key,...' where scope is retrieval, ingest, or admin. Example: 'retrieval:rk_abc,ingest:ik_def,admin:ak_ghi'. A single key without scope prefix is treated as admin for backward compatibility.",
    },
    {
      key: 'TOP_K',
      required: false,
      help: `Default number of documents to retrieve (default ${config.topK}).`,
    },
    {
      key: 'CHAT_API_KEY',
      required: true,
      help: 'API key used by the streaming /chat endpoint.',
    },
    {
      key: 'CHAT_MODEL',
      required: false,
      help: `Chat model override (default ${chatModel}).`,
    },
  ];

  if (chatProvider === 'custom') {
    envVars.push({
      key: 'CHAT_BASE_URL',
      required: true,
      help: 'OpenAI-compatible base URL used by the chat endpoint.',
    });
  }

  if (config.runtimeProfile === 'assistant') {
    envVars.push(
      {
        key: 'LARKUP_MCP_CONNECTIONS',
        required: false,
        help: 'JSON array of enabled MCP connection records. Configure this as a deployment secret; local runs receive it from Agent Customization automatically.',
      },
      {
        key: 'LARKUP_SANDBOX_BACKEND',
        required: false,
        help: 'Sandbox backend for the Agent executeAnalysis tool (default local).',
      },
      {
        key: 'LARKUP_SANDBOX_CREDENTIALS',
        required: false,
        help: 'JSON sandbox credentials for LARKUP_SANDBOX_BACKEND. Configure this as a deployment secret.',
      },
      {
        key: 'LARKUP_AGENT_PLUGIN_MODULES',
        required: false,
        help: 'JSON array of installed plugin modules that implement the Larkup Agent tool factory contract.',
      },
    );
  }

  if (config.vectorStore === 'pinecone') {
    envVars.push(
      { key: 'PINECONE_API_KEY', required: true, help: 'Pinecone API key.' },
      {
        key: 'PINECONE_INDEX',
        required: true,
        help: 'Pinecone index name to query.',
      },
      {
        key: 'PINECONE_NAMESPACE',
        required: false,
        help: "Pinecone namespace (default 'default').",
      },
      {
        key: 'PINECONE_SPARSE_MODEL',
        required: false,
        help: 'Pinecone sparse model (for hybrid search).',
      },
      {
        key: 'PINECONE_SPARSE_INDEX',
        required: false,
        help: 'Pinecone sparse index name (for hybrid search).',
      },
    );
  } else {
    envVars.push(
      {
        key: 'LANCEDB_MODE',
        required: false,
        help: "'local' (on-disk), 's3' (S3-compatible), or 'cloud' (default 'local').",
      },
      {
        key: 'LANCEDB_PATH',
        required: false,
        help: 'On-disk path to the LanceDB tables (local mode).',
      },
      {
        key: 'LANCEDB_TABLE',
        required: false,
        help: "Table name holding the embedded chunks (default 'documents').",
      },
      {
        key: 'LANCEDB_S3_URI',
        required: false,
        help: 'S3-compatible LanceDB URI (e.g. s3://bucket/prefix).',
      },
      {
        key: 'AWS_ENDPOINT',
        required: false,
        help: 'S3-compatible endpoint (required for Cloudflare R2).',
      },
      {
        key: 'AWS_REGION',
        required: false,
        help: 'S3 region (use auto for Cloudflare R2).',
      },
      {
        key: 'AWS_ACCESS_KEY_ID',
        required: false,
        help: 'S3-compatible access key ID.',
      },
      {
        key: 'AWS_SECRET_ACCESS_KEY',
        required: false,
        help: 'S3-compatible secret access key.',
      },
      {
        key: 'LANCEDB_URI',
        required: false,
        help: 'LanceDB Cloud database URI (cloud mode).',
      },
      {
        key: 'LANCEDB_API_KEY',
        required: false,
        help: 'LanceDB Cloud API key (cloud mode).',
      },
    );
  }

  const server: GeneratedServer = {
    projectName: config.projectName,
    files: [],
    dependencies,
    envVars,
  };

  const pkg = {
    name: config.projectName,
    version: '1.0.0',
    private: true,
    type: 'module',
    description: `Larkup ${config.runtimeProfile === 'assistant' ? 'Agent' : 'Knowledge'} Server (${
      store.label
    })`,
    scripts: {
      start: 'node --env-file=.env server.mjs',
      demo: 'node demo.mjs',
    },
    dependencies,
    engines: { node: '>=20' },
  };

  const generatedEnv = server.envVars
    .map((e) => {
      let val = '';
      if (e.key === 'EMBEDDING_API_KEY') val = config.embeddingApiKey || '';
      if (e.key === 'CHAT_API_KEY') {
        const modelName = config.chatModelId?.replace(/^custom:/, '') || '';
        const customKey = config.customChatModels?.find(
          (model) => model.modelName === modelName,
        )?.apiKey;
        val = config.chatApiKey || customKey || config.embeddingApiKey || '';
      }
      if (e.key === 'CHAT_MODEL') val = chatModel;
      if (e.key === 'CHAT_BASE_URL') {
        const modelName = config.chatModelId?.replace(/^custom:/, '') || '';
        val =
          config.customChatModels?.find((model) => model.modelName === modelName)?.baseUrl || '';
      }
      if (e.key === 'PINECONE_API_KEY') val = config.storeConfig.apiKey || '';
      if (e.key === 'PINECONE_INDEX') val = config.storeConfig.indexName || '';
      if (e.key === 'PINECONE_NAMESPACE') val = config.storeConfig.namespace || '';
      if (e.key === 'LANCEDB_MODE') val = config.storeConfig.mode || 'local';
      if (e.key === 'LANCEDB_URI') val = config.storeConfig.uri || '';
      if (e.key === 'LANCEDB_API_KEY') val = config.storeConfig.apiKey || '';
      if (e.key === 'LANCEDB_S3_URI') val = config.storeConfig.s3Uri || '';
      if (e.key === 'AWS_ENDPOINT') val = config.storeConfig.s3Endpoint || '';
      if (e.key === 'AWS_REGION') val = config.storeConfig.s3Region || '';
      if (e.key === 'AWS_ACCESS_KEY_ID') val = config.storeConfig.s3AccessKeyId || '';
      if (e.key === 'AWS_SECRET_ACCESS_KEY') val = config.storeConfig.s3SecretAccessKey || '';
      return `${e.key}=${val}`;
    })
    .join('\n');

  const files: GeneratedFile[] = [
    { path: 'package.json', contents: JSON.stringify(pkg, null, 2) + '\n' },
    { path: 'server.mjs', contents: serverSource(config) },
    { path: 'chat.mjs', contents: generateChatModule(config) },
    { path: 'models.mjs', contents: chatModelsSource(config) },
    ...(config.runtimeProfile === 'assistant'
      ? [{ path: 'widget.mjs', contents: widgetSource(config) }]
      : []),
    { path: 'embed.mjs', contents: embedSource(config) },
    {
      path: 'store.mjs',
      contents: config.vectorStore === 'pinecone' ? pineconeStore() : lancedbStore(),
    },
    { path: 'demo.mjs', contents: demoSource() },
    { path: 'Dockerfile', contents: dockerfile() },
    { path: '.dockerignore', contents: dockerignore() },
    {
      path: 'docker-compose.yml',
      contents: dockerCompose(config.projectName, usesLocalLance),
    },
    { path: 'vercel.json', contents: vercelJson() },
    { path: '.env.example', contents: envExample(server) },
    { path: '.env', contents: generatedEnv },
    { path: '.gitignore', contents: 'node_modules\n.env\n.DS_Store\n' },
    { path: 'README.md', contents: readme(config, server) },
  ].map((f) => ({ ...f, language: lang(f.path) }));

  try {
    const fs = require('node:fs');
    const path = require('node:path');
    const faviconPath = path.resolve(process.cwd(), 'public/favicon.ico');
    if (fs.existsSync(faviconPath)) {
      files.push({
        path: 'public/favicon.ico',
        contents: fs.readFileSync(faviconPath).toString('base64'),
        language: 'ico',
        encoding: 'base64',
      });
    } else {
      const webFaviconPath = path.resolve(process.cwd(), 'apps/web/public/favicon.ico');
      if (fs.existsSync(webFaviconPath)) {
        files.push({
          path: 'public/favicon.ico',
          contents: fs.readFileSync(webFaviconPath).toString('base64'),
          language: 'ico',
          encoding: 'base64',
        });
      }
    }
  } catch (e) {
    // Ignore if not found or fs fails
  }

  void model;

  server.files = files;
  return server;
}
