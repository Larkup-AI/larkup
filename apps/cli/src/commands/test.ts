import { readConfig } from "@larkup/core/config-store";
import { corpusStats } from "@larkup/core/documents-store";
import { getEmbeddingModel } from "@larkup/core/embeddings/registry";
import { readRun } from "@larkup/core/index-store";
import { createAdapter } from "@larkup/vector-stores/factory";
import { log } from "../ui/logger";
import { inServerScope, requireActive } from "../lib/scope";

interface TestOptions {
  server?: string;
  endpoint?: string;
  apiKey?: string;
  connection?: boolean;
}

export async function testCommand(options: TestOptions) {
  await inServerScope(options.server, async () => {
    await requireActive();
    const [config, stats, run] = await Promise.all([readConfig(), corpusStats(), readRun()]);
    const model = getEmbeddingModel(config.embeddingModelId);

    if (!model && !config.embeddingModelId.startsWith("custom:")) {
      log.error(`Unknown embedding model "${config.embeddingModelId}".`);
    }

    log.success(`Configuration is valid for ${config.projectName}.`);
    log.info(`  corpus  ${stats.docCount} document(s)`);
    log.info(`  index   ${run?.status === "completed" ? `${run.totalChunks} chunks` : "not completed"}`);

    if (options.connection) {
      const adapter = await createAdapter(config);
      await adapter.testConnection(model?.dimensions ?? 1536);
      log.success(`Connected to ${config.vectorStore}.`);
    }

    if (options.endpoint) {
      const response = await fetch(`${options.endpoint.replace(/\/$/, "")}/health`, {
        headers: options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : undefined,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) log.error(`Endpoint health check failed (${response.status}).`);
      log.success(`Endpoint is healthy: ${options.endpoint}`);
    }
  });
}
