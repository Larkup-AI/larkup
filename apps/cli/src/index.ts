#!/usr/bin/env node
/**
 * larkup-rag CLI — the second half of the toolkit's dual-mode design.
 *
 * Everything here is a thin wrapper around the SAME `core/` library the Web UI
 * uses, so the CLI and UI stay perfectly in sync: they read/write the identical
 * `.ragtoolkit/` workspace on disk and emit byte-for-byte the same server.
 *
 * Pipeline, end to end:
 *   rag init [name]                 create a workspace server (RAG project)
 *   rag add-doc --file <path>       add a document to the active server's corpus
 *   rag index                       chunk → embed → store into the vector store
 *   rag generate [--out <dir>]      emit the lightweight, deployable RAG server
 *   rag serve                       run the generated server locally (foreground)
 *   rag query "question"            retrieve the top-k chunks for a query
 *
 * Plus a few helpers: `servers`, `use <id>`, `config`.
 *
 * Run with: pnpm rag <command>  (package.json maps this to `tsx cli/index.ts`)
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  createServer,
  getWorkspace,
  getActiveServer,
  runWithServer,
  setActiveServer,
  type ServerMeta,
} from "@larkup-rag/core/workspace";
import { readConfig } from "@larkup-rag/core/config-store";
import {
  addDocument,
  corpusStats,
  readDocuments,
} from "@larkup-rag/core/documents-store";
import { createRun, runIndexer } from "@larkup-rag/core/indexing/indexer";
import { readRun } from "@larkup-rag/core/index-store";
import { generateServer } from "@larkup-rag/core/generator/generate-server";
import { emitToDisk } from "@larkup-rag/core/generator/server-runtime";
import { embedQuery } from "@larkup-rag/core/indexing/embedder";
import { createAdapter } from "@larkup-rag/vector-stores/factory";
import { getVectorStore } from "@larkup-rag/vector-stores/registry";
import { getEmbeddingModel } from "@larkup-rag/core/embeddings/registry";

/* ------------------------------- arg parsing ----------------------------- */

interface Args {
  _: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const _: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      _.push(a);
    }
  }
  return { _, flags };
}

/* --------------------------------- output -------------------------------- */

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
};

function log(msg = "") {
  process.stdout.write(msg + "\n");
}
function fail(msg: string): never {
  process.stderr.write(c.red(`✗ ${msg}`) + "\n");
  process.exit(1);
}

/** Run a body either in the active-server scope or a specific `--server` id. */
async function inServerScope<T>(
  flags: Args["flags"],
  fn: () => Promise<T>,
): Promise<T> {
  const id = typeof flags.server === "string" ? flags.server : null;
  if (id) {
    const found = await runWithServer(id, () => getActiveServer());
    if (!found) fail(`No server with id "${id}".`);
    return runWithServer(id, fn);
  }
  return fn();
}

async function requireActive(): Promise<ServerMeta> {
  const server = await getActiveServer();
  if (!server) {
    fail('No active server. Create one first with: pnpm rag init "my-rag"');
  }
  return server;
}

/* ------------------------------- commands -------------------------------- */

async function cmdInit(args: Args) {
  const name =
    args._[0] ??
    (typeof args.flags.name === "string" ? args.flags.name : "my-rag");
  const { server } = await createServer(name);
  log(c.green(`✓ Created server ${c.bold(server.name)}`));
  log(c.dim(`  id   ${server.id}`));
  log(c.dim(`  port ${server.port}  (the generated server listens here)`));
  log(c.dim("  it is now the active server"));
}

async function cmdServers() {
  const ws = await getWorkspace();
  if (ws.servers.length === 0) {
    log(c.dim('No servers yet. Create one with: pnpm rag init "my-rag"'));
    return;
  }
  log(c.bold("Servers"));
  for (const s of ws.servers) {
    const active = s.id === ws.activeServerId;
    const marker = active ? c.green("●") : c.dim("○");
    log(`${marker} ${c.bold(s.name)} ${c.dim(`:${s.port}`)} ${c.dim(s.id)}`);
  }
}

async function cmdUse(args: Args) {
  const target = args._[0];
  if (!target) fail("Usage: pnpm rag use <serverId|name>");
  const ws = await getWorkspace();
  // Match by id first, then fall back to an exact name match.
  const next =
    ws.servers.find((s) => s.id === target) ??
    ws.servers.find((s) => s.name === target);
  if (!next) fail(`No server matching "${target}".`);
  await setActiveServer(next.id);
  log(c.green(`✓ Active server is now ${c.bold(next.name)}`));
}

async function cmdConfig(args: Args) {
  await inServerScope(args.flags, async () => {
    const server = await requireActive();
    const config = await readConfig();
    const stats = await corpusStats();
    const run = await readRun();
    const store = getVectorStore(config.vectorStore);
    const model = getEmbeddingModel(config.embeddingModelId);
    log(c.bold(server.name));
    log(`  project    ${config.projectName}`);
    log(`  model      ${model?.label ?? config.embeddingModelId}`);
    log(`  store      ${store?.label ?? config.vectorStore}`);
    log(`  index      ${config.indexType}`);
    log(
      `  chunking   ${config.chunking.chunkSize}/${config.chunking.chunkOverlap} (${config.chunking.strategy})`,
    );
    log(`  top-k      ${config.topK}`);
    log(
      `  corpus     ${stats.docCount} docs · ${stats.charCount.toLocaleString()} chars`,
    );
    log(
      `  indexed    ${run?.status === "completed" ? `yes (${run.totalChunks} chunks)` : "no"}`,
    );
  });
}

async function cmdAddDoc(args: Args) {
  await inServerScope(args.flags, async () => {
    await requireActive();

    const file = typeof args.flags.file === "string" ? args.flags.file : null;
    const text = typeof args.flags.text === "string" ? args.flags.text : null;
    const url = typeof args.flags.url === "string" ? args.flags.url : undefined;
    let title =
      typeof args.flags.title === "string" ? args.flags.title : undefined;

    let content: string;
    if (file) {
      const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
      try {
        content = await fs.readFile(abs, "utf8");
      } catch {
        fail(`Could not read file: ${abs}`);
      }
      if (!title) title = path.basename(file);
    } else if (text) {
      content = text;
    } else {
      fail("Provide --file <path> or --text <string>.");
    }

    if (!content!.trim()) fail("The document content is empty.");

    const doc = await addDocument({
      title: title ?? "Untitled",
      content: content!,
      source: file ? "upload" : "paste",
      url,
    });
    log(
      c.green(
        `✓ Added "${doc.title}" (${doc.charCount.toLocaleString()} chars)`,
      ),
    );
    const stats = await corpusStats();
    log(c.dim(`  corpus now has ${stats.docCount} document(s)`));
  });
}

async function cmdIndex(args: Args) {
  await inServerScope(args.flags, async () => {
    await requireActive();
    const config = await readConfig();
    const docs = await readDocuments();
    if (docs.length === 0) {
      fail(
        "Corpus is empty. Add documents first: pnpm rag add-doc --file <path>",
      );
    }
    if (!getEmbeddingModel(config.embeddingModelId)) {
      fail(
        `Unknown embedding model "${config.embeddingModelId}". Set it in the Configure stage.`,
      );
    }
    if (!process.env.AI_GATEWAY_API_KEY) {
      log(
        c.yellow(
          "! AI_GATEWAY_API_KEY is not set — embedding will likely fail.",
        ),
      );
    }

    log(
      c.cyan(`Indexing ${docs.length} document(s) into ${config.vectorStore}…`),
    );
    const run = await createRun(config);

    // Poll the run store so the CLI shows live progress like the UI does.
    let done = false;
    const timer = setInterval(async () => {
      const r = await readRun();
      if (!r || done) return;
      if (r.totalChunks > 0) {
        process.stdout.write(
          `\r  ${c.dim(r.status.padEnd(10))} ${r.processedChunks}/${r.totalChunks} chunks   `,
        );
      } else {
        process.stdout.write(`\r  ${c.dim(r.status)}…   `);
      }
    }, 400);

    await runIndexer(run.id, config);
    done = true;
    clearInterval(timer);
    process.stdout.write("\r");

    const final = await readRun();
    if (final?.status === "completed") {
      log(
        c.green(
          `✓ Indexed ${final.totalChunks} chunks (${final.dimensions}-dim) in ${((final.durationMs ?? 0) / 1000).toFixed(1)}s`,
        ),
      );
    } else {
      fail(final?.error ?? "Indexing failed.");
    }
  });
}

async function cmdGenerate(args: Args) {
  await inServerScope(args.flags, async () => {
    await requireActive();
    const config = await readConfig();

    const out = typeof args.flags.out === "string" ? args.flags.out : null;
    if (out) {
      const dir = path.isAbsolute(out) ? out : path.join(process.cwd(), out);
      const server = generateServer(config);
      await fs.mkdir(dir, { recursive: true });
      for (const f of server.files) {
        const dest = path.join(dir, f.path);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, f.contents, "utf8");
      }
      log(c.green(`✓ Generated ${server.files.length} files → ${dir}`));
    } else {
      const dir = await emitToDisk(config);
      const server = generateServer(config);
      log(c.green(`✓ Generated ${server.files.length} files → ${dir}`));
    }

    const server = generateServer(config);
    const deps = Object.entries(server.dependencies)
      .map(([k, v]) => `${k}@${v}`)
      .join(", ");
    log(c.dim(`  deps: ${deps}`));
    log(c.dim("  run it locally with: pnpm rag serve"));
  });
}

async function cmdServe(args: Args) {
  await inServerScope(args.flags, async () => {
    const server = await requireActive();
    const config = await readConfig();

    const isLocalLance =
      config.vectorStore === "lancedb" && config.storeConfig.mode !== "cloud";

    const dir = await emitToDisk(config);
    log(c.cyan("Installing minimal server dependencies…"));
    await run("npm", ["install", "--omit=dev"], dir);

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: String(server.port),
      TOP_K: String(config.topK),
    };
    if (isLocalLance) {
      const dbPath = config.storeConfig.dbPath || "./.ragtoolkit/lancedb";
      env.LANCEDB_MODE = "local";
      env.LANCEDB_PATH = path.isAbsolute(dbPath)
        ? dbPath
        : path.join(process.cwd(), dbPath);
      env.LANCEDB_TABLE = config.storeConfig.tableName || "documents";
    }

    log(
      c.green(
        `✓ Serving ${c.bold(config.projectName)} on http://localhost:${server.port}`,
      ),
    );
    log(c.dim("  POST /query  ·  GET /health  ·  Ctrl+C to stop"));

    // Foreground: inherit stdio so logs stream and Ctrl+C stops the server.
    const child = spawn("node", ["server.mjs"], {
      cwd: dir,
      stdio: "inherit",
      env,
    });
    await new Promise<void>((resolve) => {
      child.on("exit", () => resolve());
      process.on("SIGINT", () => child.kill("SIGINT"));
      process.on("SIGTERM", () => child.kill("SIGTERM"));
    });
  });
}

async function cmdQuery(args: Args) {
  await inServerScope(args.flags, async () => {
    await requireActive();
    const question = args._.join(" ").trim();
    if (!question) fail('Usage: pnpm rag query "your question" [--topK 5]');

    const config = await readConfig();
    const run = await readRun();
    if (!run || run.status !== "completed" || (run.totalChunks ?? 0) === 0) {
      fail("No index to query. Build one first: pnpm rag index");
    }
    if (!process.env.AI_GATEWAY_API_KEY) {
      log(
        c.yellow(
          "! AI_GATEWAY_API_KEY is not set — embedding will likely fail.",
        ),
      );
    }

    const topK = Math.min(
      Math.max(Number(args.flags.topK) || config.topK, 1),
      20,
    );

    const started = Date.now();
    const vector = await embedQuery(config.embeddingModelId, question);
    const adapter = await createAdapter(config);
    const hits = await adapter.query(vector, topK, question);
    const took = Date.now() - started;

    log(`\n${c.bold("Query:")} ${question}`);
    log(c.dim(`${hits.length} result(s) · ${took}ms\n`));
    if (hits.length === 0) {
      log(c.dim("No matches. Try rephrasing or indexing more content."));
      return;
    }
    hits.forEach((hit, i) => {
      const pct = Math.round(Math.min(Math.max(hit.score, 0), 1) * 100);
      log(
        `${c.cyan(`#${i + 1}`)} ${c.bold(hit.title || "Untitled")} ${c.dim(`(${pct}%)`)}`,
      );
      if (hit.url) log(c.dim(`   ${hit.url}`));
      const snippet = hit.text.slice(0, 200).replace(/\s+/g, " ").trim();
      log(`   ${snippet}${hit.text.length > 200 ? "…" : ""}\n`);
    });
  });
}

/* ----------------------------- child process ----------------------------- */

function run(cmd: string, argv: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { cwd, stdio: "inherit" });
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${cmd} exited with code ${code}`)),
    );
    child.on("error", reject);
  });
}

/* --------------------------------- help ---------------------------------- */

function help() {
  log(`${c.bold("larkup-rag")} — build, index, and serve a RAG pipeline from the terminal.

${c.bold("Usage")}
  pnpm rag <command> [options]

${c.bold("Commands")}
  init [name]                 Create a new RAG server (workspace project)
  servers                     List all servers (● = active)
  use <serverId>              Switch the active server
  config                      Show the active server's configuration + status
  add-doc --file <path>       Add a document from a file
  add-doc --text "<text>"     Add a document from inline text
                              (optional: --title <t> --url <u>)
  index                       Chunk → embed → store the corpus
  generate [--out <dir>]      Emit the deployable RAG server to disk
  serve                       Run the generated server locally (foreground)
  query "<question>"          Retrieve top-k chunks (optional: --topK <n>)

${c.bold("Global options")}
  --server <id>               Target a specific server instead of the active one

${c.bold("Notes")}
  Set ${c.cyan("AI_GATEWAY_API_KEY")} in your environment so embeddings can run.
  The CLI and Web UI share the same ${c.cyan(".ragtoolkit/")} workspace on disk.
`);
}

/* ------------------------------- dispatch -------------------------------- */

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const command = args._.shift();

  switch (command) {
    case "init":
      return cmdInit(args);
    case "servers":
    case "list":
      return cmdServers();
    case "use":
      return cmdUse(args);
    case "config":
      return cmdConfig(args);
    case "add-doc":
      return cmdAddDoc(args);
    case "index":
      return cmdIndex(args);
    case "generate":
      return cmdGenerate(args);
    case "serve":
      return cmdServe(args);
    case "query":
      return cmdQuery(args);
    case "help":
    case "--help":
    case "-h":
    case undefined:
      return help();
    default:
      log(c.red(`Unknown command: ${command}`));
      help();
      process.exit(1);
  }
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
