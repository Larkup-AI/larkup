import { readConfig } from '@larkup/core/config-store';
import { addDocument, readDocuments } from '@larkup/core/documents-store';
import { createRun, runIndexer } from '@larkup/core/indexing/indexer';
import { readRun } from '@larkup/core/index-store';
import { getEmbeddingModel } from '@larkup/core/embeddings/registry';
import { log } from '../ui/logger';
import { inProjectScope, requireActiveProject } from '../lib/scope';
import { prompts } from '../ui/prompts';
import { ensureApiKey } from '../lib/keys';
import { collectFiles, filterLocalFiles, isMediaPath, readTextFiles } from '../lib/local-files';
import { mediaCommand } from './media';

interface IndexOptions {
  project?: string;
  run?: boolean;
  incremental?: boolean;
  pdf?: boolean;
  json?: boolean;
  media?: boolean;
  image?: boolean;
  audio?: boolean;
  video?: boolean;
  extension?: string;
}

function selectedKinds(options: IndexOptions) {
  return [
    ...(options.pdf ? (['pdf'] as const) : []),
    ...(options.json ? (['json'] as const) : []),
    ...(options.media ? (['media'] as const) : []),
    ...(options.image ? (['image'] as const) : []),
    ...(options.audio ? (['audio'] as const) : []),
    ...(options.video ? (['video'] as const) : []),
  ];
}

function progressBar(current: number, total: number): string {
  if (total <= 0) return 'Preparing chunks';
  const width = 24;
  const completed = Math.min(width, Math.round((current / total) * width));
  const percentage = Math.min(100, Math.round((current / total) * 100));
  return `[${'█'.repeat(completed)}${'░'.repeat(width - completed)}] ${percentage}%`;
}

export async function indexCommand(inputs: string[], options: IndexOptions) {
  await inProjectScope(options.project, async () => {
    await requireActiveProject();
    if (inputs.length > 0) {
      const files = await collectFiles(inputs);
      const selected = filterLocalFiles(files, {
        kinds: selectedKinds(options),
        extensions: options.extension?.split(','),
      });
      const textFiles = await readTextFiles(selected);
      const mediaFiles = selected.filter(isMediaPath);

      for (const document of textFiles) {
        await addDocument({ title: document.title, content: document.content, source: 'files' });
      }
      if (textFiles.length > 0)
        log.success(`Loaded ${textFiles.length} document${textFiles.length === 1 ? '' : 's'}.`);
      if (mediaFiles.length > 0) await mediaCommand(mediaFiles, { index: false });
      if (textFiles.length === 0 && mediaFiles.length === 0) {
        log.error('No supported text or media files were found.');
      }
      if (options.run === false) {
        log.dim('Files loaded without building an index.');
        return;
      }
    }
    const config = await readConfig();
    const docs = await readDocuments();

    if (docs.length === 0) {
      log.error('Corpus is empty. Add documents first: larkup add-doc --file <path>');
    }

    if (!getEmbeddingModel(config.embeddingModelId)) {
      log.error(
        `Unknown embedding model "${config.embeddingModelId}". Set it in the Configure stage.`,
      );
    }

    await ensureApiKey(config, 'embedding');

    log.info(log.fmt.cyan(`Indexing ${docs.length} document(s) into ${config.vectorStore}…`));
    const previousRun = await readRun();
    const run = await createRun(config);

    const s = prompts.spinner();
    s.start('Starting indexer...');

    let done = false;
    const timer = setInterval(async () => {
      const r = await readRun();
      if (!r || done) return;
      if (r.totalChunks > 0) {
        s.message(
          `${r.status.padEnd(10)} ${progressBar(r.processedChunks, r.totalChunks)} ${r.processedChunks}/${r.totalChunks} chunks`,
        );
      } else {
        s.message(`${r.status}…`);
      }
    }, 400);

    try {
      await runIndexer(
        run.id,
        config,
        options.incremental && previousRun?.status === 'completed' ? previousRun : null,
      );
    } catch (e: any) {
      done = true;
      clearInterval(timer);
      s.stop('Indexing failed.');
      log.error(e.message || 'Indexing failed');
    }

    done = true;
    clearInterval(timer);

    const final = await readRun();
    if (final?.status === 'completed') {
      s.stop(
        `Indexed ${final.totalChunks} chunks (${final.dimensions}-dim) in ${(
          (final.durationMs ?? 0) / 1000
        ).toFixed(1)}s`,
      );
      log.success('Indexing complete!');
    } else {
      s.stop('Indexing failed.');
      log.error(final?.error ?? 'Indexing failed.');
    }
  });
}
