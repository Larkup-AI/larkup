import { readConfig } from "@larkup/core/config-store";
import { corpusStats } from "@larkup/core/documents-store";
import { readRun } from "@larkup/core/index-store";
import { getVectorStore } from "@larkup/vector-stores/registry";
import { getEmbeddingModel } from "@larkup/core/embeddings/registry";
import { log } from "../ui/logger";
import { inServerScope, requireActive } from "../lib/scope";

export async function configCommand(options: { server?: string }) {
  await inServerScope(options.server, async () => {
    const server = await requireActive();
    const config = await readConfig();
    const stats = await corpusStats();
    const run = await readRun();
    
    const store = getVectorStore(config.vectorStore);
    const model = getEmbeddingModel(config.embeddingModelId);
    
    log.bold(server.name);
    log.info(`  project    ${config.projectName}`);
    log.info(`  model      ${model?.label ?? config.embeddingModelId}`);
    log.info(`  store      ${store?.label ?? config.vectorStore}`);
    log.info(`  index      ${config.indexType}`);
    log.info(`  chunking   ${config.chunking.chunkSize}/${config.chunking.chunkOverlap} (${config.chunking.strategy})`);
    log.info(`  top-k      ${config.topK}`);
    log.info(`  corpus     ${stats.docCount} docs · ${stats.charCount.toLocaleString()} chars`);
    log.info(`  indexed    ${run?.status === "completed" ? `yes (${run.totalChunks} chunks)` : "no"}`);
  });
}
