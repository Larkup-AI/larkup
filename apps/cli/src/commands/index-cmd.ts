import { readConfig } from "@larkup/core/config-store";
import { addDocument, readDocuments } from "@larkup/core/documents-store";
import { createRun, runIndexer } from "@larkup/core/indexing/indexer";
import { readRun } from "@larkup/core/index-store";
import { getEmbeddingModel } from "@larkup/core/embeddings/registry";
import { log } from "../ui/logger";
import { inServerScope, requireActive } from "../lib/scope";
import { prompts } from "../ui/prompts";
import { ensureApiKey } from "../lib/keys";
import { collectFiles, isMediaPath, readTextFiles } from "../lib/local-files";
import { mediaCommand } from "./media";

interface IndexOptions {
  server?: string;
  run?: boolean;
  incremental?: boolean;
}

export async function indexCommand(inputs: string[], options: IndexOptions) {
  await inServerScope(options.server, async () => {
    await requireActive();
    if (inputs.length > 0) {
      const files = await collectFiles(inputs);
      const textFiles = await readTextFiles(files);
      const mediaFiles = files.filter(isMediaPath);

      for (const document of textFiles) {
        await addDocument({ title: document.title, content: document.content, source: "upload" });
      }
      if (textFiles.length > 0) log.success(`Loaded ${textFiles.length} document${textFiles.length === 1 ? "" : "s"}.`);
      if (mediaFiles.length > 0) await mediaCommand(mediaFiles, { index: false });
      if (textFiles.length === 0 && mediaFiles.length === 0) {
        log.error("No supported text or media files were found.");
      }
      if (options.run === false) {
        log.dim("Files loaded without building an index.");
        return;
      }
    }
    const config = await readConfig();
    const docs = await readDocuments();

    if (docs.length === 0) {
      log.error("Corpus is empty. Add documents first: larkup add-doc --file <path>");
    }
    
    if (!getEmbeddingModel(config.embeddingModelId)) {
      log.error(`Unknown embedding model "${config.embeddingModelId}". Set it in the Configure stage.`);
    }

    await ensureApiKey(config, "embedding");

    log.info(log.fmt.cyan(`Indexing ${docs.length} document(s) into ${config.vectorStore}…`));
    const previousRun = await readRun();
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
      await runIndexer(run.id, config, options.incremental && previousRun?.status === "completed" ? previousRun : null);
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
