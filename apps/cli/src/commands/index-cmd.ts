import { readConfig } from "@larkup-rag/core/config-store";
import { readDocuments } from "@larkup-rag/core/documents-store";
import { createRun, runIndexer } from "@larkup-rag/core/indexing/indexer";
import { readRun } from "@larkup-rag/core/index-store";
import { getEmbeddingModel } from "@larkup-rag/core/embeddings/registry";
import { log } from "../ui/logger";
import { inServerScope, requireActive } from "../lib/scope";
import { prompts } from "../ui/prompts";
import { ensureApiKey } from "../lib/keys";

export async function indexCommand(options: { server?: string }) {
  await inServerScope(options.server, async () => {
    await requireActive();
    const config = await readConfig();
    const docs = await readDocuments();

    if (docs.length === 0) {
      log.error("Corpus is empty. Add documents first: larkuprag add-doc --file <path>");
    }
    
    if (!getEmbeddingModel(config.embeddingModelId)) {
      log.error(`Unknown embedding model "${config.embeddingModelId}". Set it in the Configure stage.`);
    }

    await ensureApiKey(config, "embedding");

    log.info(log.fmt.cyan(`Indexing ${docs.length} document(s) into ${config.vectorStore}…`));
    const run = await createRun(config);
    
    const s = prompts.spinner();
    s.start("Starting indexer...");

    let done = false;
    const timer = setInterval(async () => {
      const r = await readRun();
      if (!r || done) return;
      if (r.totalChunks > 0) {
        s.message(`${r.status.padEnd(10)} ${r.processedChunks}/${r.totalChunks} chunks`);
      } else {
        s.message(`${r.status}…`);
      }
    }, 400);

    try {
      await runIndexer(run.id, config);
    } catch (e: any) {
      done = true;
      clearInterval(timer);
      s.stop("Indexing failed.");
      log.error(e.message || "Indexing failed");
    }

    done = true;
    clearInterval(timer);
    
    const final = await readRun();
    if (final?.status === "completed") {
      s.stop(`Indexed ${final.totalChunks} chunks (${final.dimensions}-dim) in ${((final.durationMs ?? 0) / 1000).toFixed(1)}s`);
      log.success("Indexing complete!");
    } else {
      s.stop("Indexing failed.");
      log.error(final?.error ?? "Indexing failed.");
    }
  });
}
