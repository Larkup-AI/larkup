import { readConfig } from "@larkup/core/config-store";
import { readRun } from "@larkup/core/index-store";
import { embedQuery } from "@larkup/core/indexing/embedder";
import { createAdapter } from "@larkup/vector-stores/factory";
import { log } from "../ui/logger";
import { inServerScope, requireActive } from "../lib/scope";
import { ensureApiKey } from "../lib/keys";

export async function queryCommand(question: string, options: { server?: string; topK?: string }) {
  await inServerScope(options.server, async () => {
    await requireActive();
    if (!question) log.error('Usage: larkup query "your question" [--topK 5]');

    const config = await readConfig();
    const run = await readRun();
    
    if (!run || run.status !== "completed" || (run.totalChunks ?? 0) === 0) {
      log.error("No index to query. Build one first: larkup index");
    }

    await ensureApiKey(config, "embedding");

    const topK = Math.min(
      Math.max(Number(options.topK) || config.topK, 1),
      20,
    );

    const started = Date.now();
    const vector = await embedQuery(config, question);
    const adapter = await createAdapter(config);
    const hits = await adapter.query(vector, topK, question);
    const took = Date.now() - started;

    log.info(`\n${log.fmt.bold("Query:")} ${question}`);
    log.dim(`${hits.length} result(s) · ${took}ms\n`);
    
    if (hits.length === 0) {
      log.dim("No matches. Try rephrasing or indexing more content.");
      return;
    }

    hits.forEach((hit, i) => {
      const pct = Math.round(Math.min(Math.max(hit.score, 0), 1) * 100);
      log.info(`${log.fmt.cyan(`#${i + 1}`)} ${log.fmt.bold(hit.title || "Untitled")} ${log.fmt.dim(`(${pct}%)`)}`);
      
      if (hit.url) log.dim(`   ${hit.url}`);
      
      const snippet = hit.text.slice(0, 200).replace(/\s+/g, " ").trim();
      log.info(`   ${snippet}${hit.text.length > 200 ? "…" : ""}\n`);
    });
  });
}
