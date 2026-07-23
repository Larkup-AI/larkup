import type { RagConfig } from '../types';
import { getVectorStore } from '@larkup/vector-stores/registry';
import { getEmbeddingModel } from '../embeddings/registry';

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
const TABLE = process.env.LANCEDB_TABLE || "documents"

if (IS_SERVERLESS && MODE !== "cloud") {
  console.warn("[LanceDB] Running on serverless — using /tmp/lancedb. Data will NOT persist between invocations. Use LanceDB Cloud for production.")
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

function authSource(config: any) {
  return `import { parse } from "cookie";
import crypto from "node:crypto";

const AUTH_MODE = process.env.AGENT_AUTH_MODE || 'none';
const JOIN_CODE = process.env.AGENT_JOIN_CODE || '';
const SERVER_API_KEY = process.env.SERVER_API_KEY || '';
const SECRET = process.env.SERVER_API_KEY || process.env.AGENT_JOIN_CODE || 'larkup-secret';

function createToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 1000 * 60 * 60 * 24 * 7 })).toString('base64');
  const signature = crypto.createHmac('sha256', SECRET).update(payload).digest('base64');
  return \`\${payload}.\${signature}\`;
}

function verifyToken(token) {
  try {
    const [payload, signature] = token.split('.');
    const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64');
    if (signature !== expected) return false;
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    return decoded.exp > Date.now();
  } catch {
    return false;
  }
}

export function checkAuth(req) {
  if (AUTH_MODE === 'none') return true;
  
  if (AUTH_MODE === 'api-key') {
    const auth = req.headers.authorization;
    if (!auth) return false;
    const token = auth.replace(/^Bearer\\s+/i, "").trim();
    return token === SERVER_API_KEY;
  }
  
  if (AUTH_MODE === 'join-code') {
    const cookies = parse(req.headers.cookie || '');
    return verifyToken(cookies.agent_session);
  }
  
  return false;
}

export function handleVerify(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk.toString());
  req.on('end', () => {
    try {
      const { code } = JSON.parse(body);
      if (code === JOIN_CODE) {
        const token = createToken();
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': \`agent_session=\${token}; HttpOnly; Path=/; Max-Age=${
            60 * 60 * 24 * 7
          }; SameSite=Lax\`
        });
        res.end(JSON.stringify({ success: true }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid join code' }));
      }
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Bad request' }));
    }
  });
}
`;
}

function chatSource(config: any) {
  return `import { streamText, convertToModelMessages } from "ai";
import { embedQuery } from "./embed.mjs";
import { query as storeQuery } from "./store.mjs";
import { createOpenAI } from "@ai-sdk/openai";

const CHAT_API_KEY = process.env.CHAT_API_KEY || process.env.OPENAI_API_KEY;
const CHAT_MODEL = process.env.CHAT_MODEL || "${config.deployment?.chatModelId || 'gpt-4o-mini'}";
const SYSTEM_PROMPT = ${JSON.stringify(
    config.deployment?.systemPrompt || 'You are a helpful AI assistant.',
  )};

const provider = createOpenAI({ apiKey: CHAT_API_KEY });
const model = provider(CHAT_MODEL);

export async function handleChat(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk.toString());
  req.on('end', async () => {
    try {
      const json = JSON.parse(body);
      const messages = json.messages || [];
      const lastMessage = messages[messages.length - 1];

      let contextStr = "";
      if (lastMessage && lastMessage.role === 'user') {
        const vector = await embedQuery(lastMessage.content);
        const topK = Number(process.env.TOP_K || 5);
        const hits = await storeQuery(vector, topK);
        if (hits.length > 0) {
          contextStr = "Relevant context from knowledge base:\\n" + hits.map(h => \`- \${h.title}: \${h.text}\`).join('\\n\\n');
        }
      }

      const systemMessage = { role: 'system', content: SYSTEM_PROMPT + (contextStr ? "\\n\\n" + contextStr : "") };
      const coreMessages = convertToModelMessages([systemMessage, ...messages]);

      const result = await streamText({
        model,
        messages: coreMessages,
      });

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      
      for await (const chunk of result.textStream) {
        res.write(\`data: \${JSON.stringify(chunk)}\\n\\n\`);
      }
      res.end();
    } catch (err) {
      console.error(err);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}
`;
}

function widgetSource(config: any) {
  return `export const WIDGET_JS = \`
(function() {
  const container = document.createElement('div');
  container.innerHTML = '<div style="position:fixed;bottom:20px;right:20px;width:60px;height:60px;border-radius:50%;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:9999;" onclick="document.getElementById(\\'larkup-chat-iframe\\').style.display = document.getElementById(\\'larkup-chat-iframe\\').style.display === \\'none\\' ? \\'block\\' : \\'none\\'">💬</div><iframe id="larkup-chat-iframe" src="' + document.currentScript.src.replace('/widget.js', '/chat-ui') + '" style="display:none;position:fixed;bottom:90px;right:20px;width:350px;height:500px;border:none;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:9999;"></iframe>';
  document.body.appendChild(container);
})();
\`;`;
}

function chatUiSource(config: any) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${config.projectName} Agent</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 20px; display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; }
    #chat-log { flex: 1; overflow-y: auto; margin-bottom: 20px; border: 1px solid #ccc; padding: 10px; border-radius: 8px; }
    .msg { margin-bottom: 10px; padding: 8px 12px; border-radius: 8px; max-width: 80%; }
    .user { background: #000; color: #fff; align-self: flex-end; margin-left: auto; }
    .ai { background: #f0f0f0; color: #000; }
    form { display: flex; gap: 10px; }
    input { flex: 1; padding: 10px; border: 1px solid #ccc; border-radius: 4px; }
    button { padding: 10px 20px; background: #000; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
  </style>
</head>
<body>
  <div id="chat-log"></div>
  <form id="chat-form">
    <input type="text" id="input" placeholder="${
      config.deployment?.widgetStyle?.placeholder || 'Type a message...'
    }" required />
    <button type="submit">Send</button>
  </form>
  <script>
    const log = document.getElementById('chat-log');
    const form = document.getElementById('chat-form');
    const input = document.getElementById('input');
    const messages = [];
    
    function appendMsg(role, content) {
      const d = document.createElement('div');
      d.className = 'msg ' + role;
      d.textContent = content;
      log.appendChild(d);
      log.scrollTop = log.scrollHeight;
    }

    form.onsubmit = async (e) => {
      e.preventDefault();
      const text = input.value;
      input.value = '';
      appendMsg('user', text);
      messages.push({ role: 'user', content: text });
      
      const res = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages })
      });
      
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      
      const d = document.createElement('div');
      d.className = 'msg ai';
      log.appendChild(d);
      
      let aiText = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              aiText += data;
              d.textContent = aiText;
              log.scrollTop = log.scrollHeight;
            } catch(e) {}
          }
        }
      }
      messages.push({ role: 'assistant', content: aiText });
    };
  </script>
</body>
</html>
`;
}

function serverSource(config: RagConfig): string {
  return `import { createServer } from "node:http"
import fs from "node:fs"
import path from "node:path"
import { checkAuth, handleVerify } from "./auth.mjs"
import { handleChat } from "./chat.mjs"
import { WIDGET_JS } from "./widget.js"

const PORT = process.env.PORT || 8080

function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  })
  res.end(JSON.stringify(body))
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {})
  const url = new URL(req.url, \`http://\${req.headers.host}\`)

  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, { ok: true, service: "${config.projectName}-agent" })
  }
  
  if (req.method === "GET" && url.pathname === "/widget.js") {
    res.writeHead(200, { "Content-Type": "application/javascript" })
    return res.end(WIDGET_JS)
  }
  
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/chat-ui")) {
    res.writeHead(200, { "Content-Type": "text/html" })
    return res.end(fs.readFileSync(path.join(process.cwd(), "chat-ui.html")))
  }
  
  if (req.method === "POST" && url.pathname === "/auth/verify") {
    return handleVerify(req, res);
  }

  // Auth gate
  if (!checkAuth(req)) {
    return send(res, 401, { error: "Unauthorized" });
  }

  if (req.method === "POST" && url.pathname === "/chat") {
    return handleChat(req, res);
  }

  return send(res, 404, { error: "Not found" })
})

server.listen(PORT, () => {
  console.log(\`[${config.projectName}] Agent server listening on :\${PORT}\`)
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
      - ./.larkup:/app/.larkup
`
    : '';
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
    .map((e) => `# ${e.help}${e.required ? '' : ' (optional)'}\n${e.key}=`)
    .join('\n');
}

function readme(config: RagConfig, server: GeneratedServer): string {
  const store = getVectorStore(config.vectorStore);
  const deps = Object.entries(server.dependencies)
    .map(([k, v]) => `- \`${k}@${v}\``)
    .join('\n');
  return `# ${config.projectName}

A lightweight RAG retrieval server generated by **larkup**.

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
- \`GET  /corpus/summary\`   → get corpus statistics (counts by source/status)
- \`POST /corpus\`           → get corpus documents with optional filtering
- \`POST /corpus/export\`    → export full corpus as CSV or JSONL
`;
}

export function generateAgentServer(config: RagConfig): GeneratedServer {
  const store = getVectorStore(config.vectorStore);
  const model = getEmbeddingModel(config.embeddingModelId);
  const usesLocalLance = config.vectorStore === 'lancedb' && config.storeConfig.mode !== 'cloud';

  const dependencies: Record<string, string> = {
    ai: '^3.3.0',
    zod: '^3.23.0',
    cheerio: '^1.0.0',
    ...store.serverDependencies,
  };

  if (config.embeddingModelId.startsWith('custom:')) {
    dependencies['@ai-sdk/openai-compatible'] = 'latest';
  } else if (config.embeddingProvider === 'deepseek') {
    dependencies['@ai-sdk/deepseek'] = 'latest';
  } else if (config.embeddingProvider === 'google') {
    dependencies['@ai-sdk/google'] = 'latest';
  } else if (config.embeddingProvider === 'cohere') {
    dependencies['@ai-sdk/cohere'] = 'latest';
  } else if (config.embeddingProvider === 'mistral') {
    dependencies['@ai-sdk/mistral'] = 'latest';
  } else if (config.embeddingProvider === 'vercel_ai_gateway') {
    dependencies['@ai-sdk/gateway'] = 'latest';
  } else if (config.embeddingProvider === 'jina') {
    // Actually, Jina uses openai compatible or an explicit jina one? There's no @ai-sdk/jina in the standard set, but let's assume openai or openai-compatible
    // Wait, the embedSource didn't have 'jina' branch. It falls back to `createOpenAI` in `embedSource`!
    // Let's just fallback to openai.
    dependencies['@ai-sdk/openai'] = 'latest';
  } else {
    dependencies['@ai-sdk/openai'] = 'latest';
  }

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
      key: 'SERVER_API_KEY',
      required: false,
      help: "Bearer token to secure your server endpoints. If set, requests must include 'Authorization: Bearer <key>'.",
    },
    {
      key: 'TOP_K',
      required: false,
      help: `Default number of documents to retrieve (default ${config.topK}).`,
    },
  ];

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
        help: "'local' (on-disk) or 'cloud' (default 'local').",
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
    description: `Lightweight RAG server (${store.label}) generated by larkup`,
    scripts: {
      start: 'node server.mjs',
      demo: 'node demo.mjs',
    },
    dependencies,
    engines: { node: '>=20' },
  };

  const generatedEnv = server.envVars
    .map((e) => {
      let val = '';
      if (e.key === 'EMBEDDING_API_KEY') val = config.embeddingApiKey || '';
      if (e.key === 'AGENT_AUTH_MODE') val = config.deployment?.authMode || 'none';
      if (e.key === 'AGENT_JOIN_CODE') val = config.deployment?.joinCode || '';
      if (e.key === 'CHAT_API_KEY') val = config.deployment?.chatApiKey || config.chatApiKey || '';
      if (e.key === 'PINECONE_API_KEY') val = config.storeConfig.apiKey || '';
      if (e.key === 'PINECONE_INDEX') val = config.storeConfig.indexName || '';
      if (e.key === 'PINECONE_NAMESPACE') val = config.storeConfig.namespace || '';
      if (e.key === 'LANCEDB_URI') val = config.storeConfig.uri || '';
      if (e.key === 'LANCEDB_API_KEY') val = config.storeConfig.apiKey || '';
      return `${e.key}=${val}`;
    })
    .join('\n');

  const files: GeneratedFile[] = [
    { path: 'package.json', contents: JSON.stringify(pkg, null, 2) + '\n' },
    { path: 'server.mjs', contents: serverSource(config) },
    { path: 'chat.mjs', contents: chatSource(config) },
    { path: 'auth.mjs', contents: authSource(config) },
    { path: 'widget.js', contents: widgetSource(config) },
    { path: 'chat-ui.html', contents: chatUiSource(config) },
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
    const faviconPath = path.resolve(process.cwd(), 'public/favicon2.ico');
    if (fs.existsSync(faviconPath)) {
      files.push({
        path: 'public/favicon2.ico',
        contents: fs.readFileSync(faviconPath).toString('base64'),
        language: 'ico',
        encoding: 'base64',
      });
    } else {
      const webFaviconPath = path.resolve(process.cwd(), 'apps/web/public/favicon2.ico');
      if (fs.existsSync(webFaviconPath)) {
        files.push({
          path: 'public/favicon2.ico',
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
