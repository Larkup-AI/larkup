import type { RagConfig } from "../types";
import { getVectorStore } from "@buddy-rag/vector-stores/registry";
import { getEmbeddingModel } from "../embeddings/registry";

export interface GeneratedFile {
  path: string;
  contents: string;
  language: string;
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

export async function list() {
  const t = await table()
  const rows = await t.query().limit(100).toArray()
  return rows.map((row) => ({
    id: row.id,
    text: row.text,
    title: row.title,
    url: row.url || undefined,
    documentId: row.documentId,
  }))
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

export async function list() {
  const res = await ns.listPaginated({ limit: 100 })
  if (!res.vectors) return []
  const ids = res.vectors.map(v => v.id)
  if (ids.length === 0) return []
  const fetched = await ns.fetch(ids)
  return Object.values(fetched.records).map(r => {
    const meta = r.metadata ?? {}
    return {
      id: r.id,
      text: meta.text ?? "",
      title: meta.title ?? "Untitled",
      url: meta.url || undefined,
      documentId: meta.documentId ?? "",
    }
  })
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
    return res.end(\`
      <!DOCTYPE html>
      <html>
        <head><title>\${${JSON.stringify(config.projectName)}} - RAG Server</title></head>
        <body style="font-family: sans-serif; padding: 2rem;">
          <h1>\${${JSON.stringify(config.projectName)}} is running</h1>
          <p>Powered by buddy-rag</p>
          <a href="/reference">View API Documentation &rarr;</a>
        </body>
      </html>
    \`)
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
      const docs = await store.list()
      return send(res, 200, { documents: docs })
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

  if (req.method === "GET" && url.pathname === "/openapi.json") {
    return send(res, 200, {
      openapi: "3.1.0",
      info: { title: "Buddy RAG Server", version: "1.0.0" },
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
            summary: "List documents",
            security: [{ bearerAuth: [] }],
            responses: { "200": { description: "Successful response" } }
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
  "routes": [{ "src": "/(.*)", "dest": "server.mjs" }]
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

A lightweight RAG retrieval server generated by **buddy-rag**.

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
- \`GET  /documents\`        → list all documents
- \`POST /documents\`        → add a document
- \`PUT  /documents/:id\`    → update a document
- \`DELETE /documents/:id\`  → delete a document
`;
}

export function generateServer(config: RagConfig): GeneratedServer {
  const store = getVectorStore(config.vectorStore);
  const model = getEmbeddingModel(config.embeddingModelId);
  const usesLocalLance =
    config.vectorStore === "lancedb" && config.storeConfig.mode !== "cloud";

  const dependencies: Record<string, string> = {
    ai: "^6.0.0",
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
    description: `Lightweight RAG server (${store.label}) generated by buddy-rag`,
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

  void model;

  server.files = files;
  return server;
}
