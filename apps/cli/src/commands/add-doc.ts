import { promises as fs } from "node:fs";
import path from "node:path";
import { addDocument, corpusStats } from "@larkup-rag/core/documents-store";
import { log } from "../ui/logger";
import { inServerScope, requireActive } from "../lib/scope";

interface AddDocOptions {
  server?: string;
  file?: string;
  text?: string;
  url?: string;
  title?: string;
}

export async function addDocCommand(options: AddDocOptions) {
  await inServerScope(options.server, async () => {
    await requireActive();

    let content: string;
    let title = options.title;

    if (options.file) {
      const abs = path.isAbsolute(options.file)
        ? options.file
        : path.join(process.cwd(), options.file);
      try {
        content = await fs.readFile(abs, "utf8");
      } catch {
        log.error(`Could not read file: ${abs}`);
      }
      if (!title) title = path.basename(options.file);
    } else if (options.text) {
      content = options.text;
    } else {
      log.error("Provide --file <path> or --text <string>.");
    }

    if (!content!.trim()) log.error("The document content is empty.");

    const doc = await addDocument({
      title: title ?? "Untitled",
      content: content!,
      source: options.file ? "upload" : "paste",
      url: options.url,
    });

    log.success(`Added "${doc.title}" (${doc.charCount.toLocaleString()} chars)`);
    const stats = await corpusStats();
    log.dim(`  corpus now has ${stats.docCount} document(s)`);
  });
}
