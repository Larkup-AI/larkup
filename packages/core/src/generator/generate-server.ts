import type { RagConfig } from "../types";
import { getVectorStore } from "@larkup-rag/vector-stores/registry";
import { getEmbeddingModel } from "../embeddings/registry";

export interface GeneratedFile {
  path: string;
  contents: string;
  language: string;
  encoding?: "utf8" | "base64";
}

export interface GeneratedServer {
  projectName: string;
  files: GeneratedFile[];
  dependencies: Record<string, string>;
  envVars: { key: string; required: boolean; help: string }[];
}

function lang(path: string): string {
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".mjs") || path.endsWith(".js")) return "javascript";
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith("Dockerfile")) return "dockerfile";
  if (path.endsWith(".yml") || path.endsWith(".yaml")) return "yaml";
  return "text";
}

function lancedbStore(): string {
  return `import * as lancedb from "@lancedb/lancedb"
import path from "node:path"

const MODE = process.env.LANCEDB_MODE || "local"
// On Vercel (and other serverless platforms), /var/task is read-only.
// Fall back to /tmp which is writable, though ephemeral per invocation.
const IS_SERVERLESS = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME
const DEFAULT_DB_PATH = IS_SERVERLESS ? "/tmp/lancedb" : "./.ragtoolkit/lancedb"
const DB_PATH = process.env.LANCEDB_PATH || DEFAULT_DB_PATH
const URI = process.env.LANCEDB_URI || ""
const API_KEY = process.env.LANCEDB_API_KEY || ""
const TABLE = process.env.LANCEDB_TABLE || "documents"

if (IS_SERVERLESS && MODE !== "cloud") {
  console.warn("[LanceDB] Running on serverless — using /tmp/lancedb. Data will NOT persist between invocations. Use LanceDB Cloud for production.")
}

let _table = null

async function table() {
  if (_table) return _table
  let conn
  if (MODE === "cloud") {
    if (!URI || !API_KEY) {
      throw new Error("LanceDB Cloud needs LANCEDB_URI and LANCEDB_API_KEY.")
    }
    conn = await lancedb.connect(URI, { apiKey: API_KEY })
  } else {
    const abs = path.isAbsolute(DB_PATH) ? DB_PATH : path.join(process.cwd(), DB_PATH)
    conn = await lancedb.connect(abs)
  }

  _table = await conn.openTable(TABLE)
  return _table
}

export async function query(vector, topK) {
  const t = await table()
  const rows = await t.search(vector).limit(topK).toArray()
  return rows.map((row) => ({
    id: row.id,
    score: typeof row._distance === "number" ? 1 / (1 + row._distance) : 0,
    text: row.text,
    title: row.title,
    url: row.url || undefined,
    documentId: row.documentId,
  }))
}

export async function list({ page = 1, limit = 20 } = {}) {
  const t = await table()
  // Fetch all rows to get total count, then slice for the page
  const allRows = await t.query().toArray()
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
  const t = await table()
  const rows = await t.query().filter(\`id = '\${id}'\`).limit(1).toArray()
  if (!rows.length) return null;
  const row = rows[0];
  return { id: row.id, text: row.text, title: row.title, url: row.url || undefined, documentId: row.documentId }
}

export async function add(docs) {
  const t = await table()
  await t.add(docs)
  return { success: true }
}

export async function remove(id) {
  const t = await table()
  await t.delete(\`id = '\${id}'\`)
  return { success: true }
}

export async function update(id, doc) {
  const t = await table()
  await t.delete(\`id = '\${id}'\`)
  await t.add([doc])
  return { success: true }
}
`;
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

function embedSource(modelId: string): string {
  return `import { embed } from "ai"

const MODEL = process.env.EMBEDDING_MODEL || ${JSON.stringify(modelId)}

export async function embedQuery(text) {
  const { embedding } = await embed({ model: MODEL, value: text })
  return embedding
}
`;
}

function serverSource(config: RagConfig): string {
  return `import { createServer } from "node:http"
import { embedQuery } from "./embed.mjs"
import * as store from "./store.mjs"
import fs from "node:fs"
import path from "node:path"
import * as cheerio from "cheerio"

const PORT = process.env.PORT || 8080
const DEFAULT_TOP_K = Number(process.env.TOP_K || ${config.topK})

console.log('[${config.projectName}] SERVER_API_KEY:', process.env.SERVER_API_KEY ? 'SET ('+process.env.SERVER_API_KEY.length+' chars, starts with: '+process.env.SERVER_API_KEY.slice(0,8)+'...)' : 'NOT SET (open access)')

function send(res, status, body) {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
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

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {})

  const url = new URL(req.url, \`http://\${req.headers.host}\`)

  if (req.method === "GET" && url.pathname === "/favicon2.ico") {
    try {
      const filepath = path.join(process.cwd(), "public", "favicon2.ico")
      if (fs.existsSync(filepath)) {
        res.writeHead(200, { "Content-Type": "image/x-icon" })
        return res.end(fs.readFileSync(filepath))
      }
      const rootFilepath = path.join(process.cwd(), "favicon2.ico")
      if (fs.existsSync(rootFilepath)) {
        res.writeHead(200, { "Content-Type": "image/x-icon" })
        return res.end(fs.readFileSync(rootFilepath))
      }
    } catch {}
  }

  const expectedKey = process.env.SERVER_API_KEY
  
  if (expectedKey) {
    const auth = req.headers.authorization
    const isPublic = url.pathname === "/" || url.pathname === "/health" || url.pathname === "/openapi.json" || url.pathname === "/reference"
    if (!isPublic) {
      if (!auth) {
        return send(res, 401, { error: "Missing Authorization header. Expected Bearer token." })
      }
      const token = auth.replace(/^Bearer\\s+/i, "").trim()
      if (token !== expectedKey.trim()) {
        console.error('[AUTH] Token mismatch. Got:', token.slice(0,20), '| Expected starts with:', expectedKey.trim().slice(0,20))
        return send(res, 403, { error: "Invalid API key." })
      }
    }
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, { ok: true, service: ${JSON.stringify(config.projectName)} })
  }

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html" })
    return res.end(\`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>\${${JSON.stringify(config.projectName)}} — RAG Server</title>
  <link rel="icon" href="/favicon2.ico" type="image/x-icon" />
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
    <p class="subtitle">Your RAG retrieval server is live and ready to accept queries.<br/>Powered by <strong style="color:#000000">Larkup RAG</strong></p>
    <div class="actions">
      <a href="/reference" class="btn btn-primary">
        <svg class="icon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        API Reference
      </a>
      <a href="https://github.com/BuddyHere-AI" target="_blank" rel="noopener" class="btn btn-outline">
        <svg class="icon" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        Larkup RAG Team
      </a>
      <a href="mailto:contact@larkup.dev" class="btn btn-outline">
        <svg class="icon" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
        Contact
      </a>
    </div>
    <div class="footer">Built with <a href="https://github.com/BuddyHere-AI/buddy-rag" target="_blank" rel="noopener">larkup-rag</a> · v1.0</div>
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
      await store.add([{ id, vector, text: doc.text, title: doc.title || "Untitled", url: doc.url, documentId: doc.documentId || id }])
      return send(res, 200, { success: true, id })
    } catch (err) {
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
        await store.add([{ id, vector, text: chunk, title: \`\${title} (part \${idx + 1})\`, url: targetUrl, documentId }])
      }

      return send(res, 200, { success: true, documentId, chunks: chunks.length })
    } catch (err) {
      return send(res, 500, { error: String(err?.message || err) })
    }
  }

  if (req.method === "GET" && url.pathname === "/openapi.json") {
    return send(res, 200, {
      openapi: "3.1.0",
      info: { title: "Larkup RAG Server", version: "1.0.0" },
      security: [{ bearerAuth: [] }],
      paths: {
        "/query": {
          post: {
            summary: "Query the RAG knowledge base",
            security: [{ bearerAuth: [] }],
            requestBody: {
              content: { "application/json": { schema: { type: "object", properties: { query: { type: "string" }, topK: { type: "number" } } } } }
            },
            responses: { "200": { description: "Successful response" } }
          }
        },
        "/documents": {
          get: {
            summary: "List documents (paginated)",
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
            security: [{ bearerAuth: [] }],
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
            responses: {
              "200": { description: "Document object" },
              "404": { description: "Document not found" }
            }
          },
          put: {
            summary: "Update a document",
            security: [{ bearerAuth: [] }],
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
            requestBody: {
              content: { "application/json": { schema: { type: "object", properties: { text: { type: "string" }, title: { type: "string" }, url: { type: "string" }, documentId: { type: "string" } } } } }
            },
            responses: { "200": { description: "Successful response" } }
          },
          delete: {
            summary: "Delete a document",
            security: [{ bearerAuth: [] }],
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
            responses: { "200": { description: "Successful response" } }
          }
        },
        "/scrape": {
          post: {
            summary: "Scrape a URL and ingest into the corpus",
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
            responses: { "200": { description: "OK" } }
          }
        }
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
          <link rel="icon" href="/favicon2.ico" type="image/x-icon" />
        </head>
        <body>
          <script id="api-reference" data-url="/openapi.json"></script>
          <script>
            const configuration = {
              "theme": "kepler",
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
})

server.listen(PORT, () => {
  console.log(\`[${config.projectName}] RAG server listening on :\${PORT}\`)
})
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
      - ./.ragtoolkit:/app/.ragtoolkit
`
    : "";
  return `services:
  ${projectName}:
    build: .
    container_name: ${projectName}
    restart: unless-stopped
    ports:
      - "8080:8080"
    env_file:
      - .env
${volume}`;
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
    .map((e) => `# ${e.help}${e.required ? "" : " (optional)"}\n${e.key}=`)
    .join("\n");
}

function readme(config: RagConfig, server: GeneratedServer): string {
  const store = getVectorStore(config.vectorStore);
  const deps = Object.entries(server.dependencies)
    .map(([k, v]) => `- \`${k}@${v}\``)
    .join("\n");
  return `# ${config.projectName}

A lightweight RAG retrieval server generated by **larkup-rag**.

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
  -H "Authorization: Bearer <your-key>" \\
  -d '{"query":"your question","topK":${config.topK}}'
\`\`\`

## Deploy

### Docker / VPS
\`\`\`bash
docker compose up -d --build
\`\`\`

### Vercel
\`\`\`bash
vercel deploy
\`\`\`

## API
- \`GET  /health\`           → \`{ ok: true }\`
- \`GET  /reference\`        → Scalar API docs UI
- \`POST /query\`            → \`{ query, hits: [{ id, score, title, url, text, documentId }] }\`
- \`GET  /documents\`        → list all documents (paginated)
- \`GET  /documents/:id\`    → get a single document
- \`POST /documents\`        → add a document
- \`PUT  /documents/:id\`    → update a document
- \`DELETE /documents/:id\`  → delete a document
- \`POST /scrape\`           → scrape a URL and ingest into the corpus
`;
}

export function generateServer(config: RagConfig): GeneratedServer {
  const store = getVectorStore(config.vectorStore);
  const model = getEmbeddingModel(config.embeddingModelId);
  const usesLocalLance =
    config.vectorStore === "lancedb" && config.storeConfig.mode !== "cloud";

  const dependencies: Record<string, string> = {
    ai: "^6.0.0",
    cheerio: "^1.0.0",
    ...store.serverDependencies,
  };

  const envVars: GeneratedServer["envVars"] = [
    {
      key: "AI_GATEWAY_API_KEY",
      required: true,
      help: "Vercel AI Gateway key used to embed incoming queries.",
    },
    {
      key: "PORT",
      required: false,
      help: "Port to listen on (default 8080).",
    },
    {
      key: "SERVER_API_KEY",
      required: false,
      help: "Bearer token to secure your server endpoints. If set, requests must include 'Authorization: Bearer <key>'.",
    },
    {
      key: "TOP_K",
      required: false,
      help: `Default number of documents to retrieve (default ${config.topK}).`,
    },
  ];

  if (config.vectorStore === "pinecone") {
    envVars.push(
      { key: "PINECONE_API_KEY", required: true, help: "Pinecone API key." },
      {
        key: "PINECONE_INDEX",
        required: true,
        help: "Pinecone index name to query.",
      },
      {
        key: "PINECONE_NAMESPACE",
        required: false,
        help: "Pinecone namespace (default 'default').",
      },
      {
        key: "PINECONE_SPARSE_MODEL",
        required: false,
        help: "Pinecone sparse model (for hybrid search).",
      },
      {
        key: "PINECONE_SPARSE_INDEX",
        required: false,
        help: "Pinecone sparse index name (for hybrid search).",
      },
    );
  } else {
    envVars.push(
      {
        key: "LANCEDB_MODE",
        required: false,
        help: "'local' (on-disk) or 'cloud' (default 'local').",
      },
      {
        key: "LANCEDB_PATH",
        required: false,
        help: "On-disk path to the LanceDB tables (local mode).",
      },
      {
        key: "LANCEDB_TABLE",
        required: false,
        help: "Table name holding the embedded chunks (default 'documents').",
      },
      {
        key: "LANCEDB_URI",
        required: false,
        help: "LanceDB Cloud database URI (cloud mode).",
      },
      {
        key: "LANCEDB_API_KEY",
        required: false,
        help: "LanceDB Cloud API key (cloud mode).",
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
    version: "1.0.0",
    private: true,
    type: "module",
    description: `Lightweight RAG server (${store.label}) generated by larkup-rag`,
    scripts: {
      start: "node server.mjs",
      demo: "node demo.mjs",
    },
    dependencies,
    engines: { node: ">=20" },
  };

  const files: GeneratedFile[] = [
    { path: "package.json", contents: JSON.stringify(pkg, null, 2) + "\n" },
    { path: "server.mjs", contents: serverSource(config) },
    { path: "embed.mjs", contents: embedSource(config.embeddingModelId) },
    {
      path: "store.mjs",
      contents:
        config.vectorStore === "pinecone" ? pineconeStore() : lancedbStore(),
    },
    { path: "demo.mjs", contents: demoSource() },
    { path: "Dockerfile", contents: dockerfile() },
    { path: ".dockerignore", contents: dockerignore() },
    {
      path: "docker-compose.yml",
      contents: dockerCompose(config.projectName, usesLocalLance),
    },
    { path: "vercel.json", contents: vercelJson() },
    { path: ".env.example", contents: envExample(server) },
    { path: "README.md", contents: readme(config, server) },
  ].map((f) => ({ ...f, language: lang(f.path) }));

  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const faviconPath = path.resolve(process.cwd(), "public/favicon2.ico");
    if (fs.existsSync(faviconPath)) {
      files.push({
        path: "public/favicon2.ico",
        contents: fs.readFileSync(faviconPath).toString("base64"),
        language: "ico",
        encoding: "base64",
      });
    } else {
      const webFaviconPath = path.resolve(
        process.cwd(),
        "apps/web/public/favicon2.ico",
      );
      if (fs.existsSync(webFaviconPath)) {
        files.push({
          path: "public/favicon2.ico",
          contents: fs.readFileSync(webFaviconPath).toString("base64"),
          language: "ico",
          encoding: "base64",
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
