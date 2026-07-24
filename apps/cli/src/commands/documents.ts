import { promises as fs } from "node:fs";
import path from "node:path";
import {
  deleteDocument,
  readDocuments,
  updateDocument,
} from "@larkup/core/documents-store";
import {
  exportCorpusAsCSV,
  exportCorpusAsJSONL,
} from "@larkup/core/corpus-retriever";
import { inServerScope, requireActive } from "../lib/scope";
import { log } from "../ui/logger";

interface DocumentsOptions {
  server?: string;
  title?: string;
  text?: string;
  file?: string;
  url?: string;
  format?: string;
  out?: string;
}

export async function documentsCommand(
  action = "list",
  idOrPath: string | undefined,
  options: DocumentsOptions,
) {
  await inServerScope(options.server, async () => {
    await requireActive();

    if (action === "list") {
      const documents = await readDocuments();
      if (documents.length === 0) {
        log.dim("The corpus is empty.");
        return;
      }
      for (const document of documents) {
        log.info(
          `${log.fmt.cyan(document.id)}  ${document.title}  ${document.source}  ${document.status}`,
        );
      }
      return;
    }

    if (action === "export") {
      const format = options.format === "jsonl" ? "jsonl" : "csv";
      const output = path.resolve(options.out || idOrPath || `corpus.${format}`);
      const content = format === "jsonl"
        ? await exportCorpusAsJSONL(undefined, Number.MAX_SAFE_INTEGER)
        : await exportCorpusAsCSV(undefined, Number.MAX_SAFE_INTEGER);
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, content, "utf8");
      log.success(`Exported corpus → ${output}`);
      return;
    }

    if (!idOrPath) {
      log.error(`Usage: larkup documents ${action} <document-id>`);
    }

    const documents = await readDocuments();
    const document = documents.find((item) => item.id === idOrPath);
    if (!document) log.error(`No document with id "${idOrPath}".`);

    if (action === "show") {
      log.bold(document!.title);
      log.dim(`  id      ${document!.id}`);
      log.dim(`  source  ${document!.source}`);
      log.dim(`  status  ${document!.status}`);
      if (document!.url) log.dim(`  url     ${document!.url}`);
      log.info(`\n${document!.content}`);
      return;
    }

    if (action === "remove" || action === "delete") {
      await deleteDocument(document!.id);
      log.success(`Removed "${document!.title}".`);
      return;
    }

    if (action === "update") {
      const content = options.file
        ? await fs.readFile(path.resolve(options.file), "utf8")
        : options.text;
      const updated = await updateDocument(document!.id, {
        title: options.title,
        content,
        url: options.url,
      });
      log.success(`Updated "${updated!.title}". Rebuild the index to apply the change.`);
      return;
    }

    log.error(`Unknown documents action "${action}". Use list, show, update, remove, or export.`);
  });
}
