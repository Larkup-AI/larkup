# larkup-rag

A dual-mode (**Web UI + CLI**) toolkit to build, index, and serve a lightweight,
deployable RAG pipeline. Both modes are thin shells over the same `core/`
library and the same on-disk `.ragtoolkit/` workspace, so anything you do in the
browser is visible from the terminal and vice-versa.

## The pipeline

The toolkit walks you through five stages:

1. **Configure** — embedding model, index type, chunking, and vector store.
2. **Data** — paste, upload, or scrape the web (Firecrawl ETL) into a corpus.
3. **Index** — chunk → embed → store into your selected vector store.
4. **Server** — generate and launch a minimal, dependency-light RAG server.
5. **Demo** — send a test query and inspect the top-k retrieved chunks.

## Workspaces & servers

The toolkit is organized as a **workspace** of independent **servers**. Each
server is a self-contained RAG project with its own config, corpus, index, and
generated artifact, stored under `.ragtoolkit/servers/<id>/`. Switch between
them from the top-left server switcher in the UI, or with `pnpm rag use <id>`.

## Web UI

```bash
pnpm install
pnpm dev
```

Open the app, complete the first-run onboarding, and work through the stages
using the left rail. The server switcher (top-left) lets you create and swap
between servers from anywhere. In the **Demo** stage you can point queries at
any server in the workspace, not just the active one.

## CLI

The CLI mirrors the entire pipeline. It is wired to the `rag` script:

```bash
pnpm rag <command> [options]
```

| Command | Description |
| --- | --- |
| `init [name]` | Create a new RAG server (workspace project) and make it active |
| `servers` | List all servers (`●` marks the active one) |
| `use <serverId\|name>` | Switch the active server (matches by id, then by exact name) |
| `config` | Show the active server's configuration and status |
| `add-doc --file <path>` | Add a document from a file |
| `add-doc --text "<text>"` | Add a document from inline text (`--title`, `--url` optional) |
| `index` | Chunk → embed → store the corpus, with live progress |
| `generate [--out <dir>]` | Emit the deployable RAG server to disk |
| `serve` | Run the generated server locally in the foreground |
| `query "<question>"` | Retrieve the top-k chunks (`--topK <n>` optional) |

The stage commands (`config`, `add-doc`, `index`, `generate`, `serve`, `query`)
accept `--server <id>` to target a specific server instead of the active one.

### Example: a full pipeline from the terminal

```bash
export AI_GATEWAY_API_KEY=...        # required so queries can be embedded

pnpm rag init "docs-bot"
pnpm rag add-doc --file ./notes.md --title "Project notes"
pnpm rag index
pnpm rag generate --out ./docs-bot-server
pnpm rag serve                        # installs deps, then serves on the
                                      # server's assigned port (first = 8080)
# in another shell:
pnpm rag query "how does indexing work?" --topK 5
```

## The generated server

`generate` (and the **Server** stage) emit a standalone server tailored to your
config:

- **Minimal deps** — only the selected vector store's packages are bundled
  (pick Pinecone → no LanceDB, and vice-versa).
- **No build step** — plain Node ESM (`node server.mjs`), embeddings via the
  Vercel AI Gateway, so no provider SDKs ship with it.
- **Deploy anywhere** — includes a `Dockerfile`, `docker-compose.yml`, and
  `vercel.json`.

It exposes:

- `GET /health` → `{ ok: true }`
- `POST /query` with `{ "query": string, "topK"?: number }` →
  `{ query, hits: [{ id, score, title, url, text, documentId }] }`

## Environment

| Variable | Used for |
| --- | --- |
| `AI_GATEWAY_API_KEY` | Embedding queries/documents via the Vercel AI Gateway |
| `FIRECRAWL_API_KEY` | Optional — cloud web scraping in the Data stage |

## Project layout

```
app/                 Next.js routes (one page per stage) + API routes
components/           UI: stage workspaces, the server switcher, dialogs
core/                 Framework-agnostic library shared by the UI, CLI, and
                      generated server (config, ETL, indexing, stores, codegen)
cli/index.ts          The CLI entry point (run via `pnpm rag`)
.ragtoolkit/          On-disk workspace (servers, corpora, indexes, artifacts)
```
