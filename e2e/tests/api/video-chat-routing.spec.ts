import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const repoRoot = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');

test('chat exposes the evidence-first video tools instead of ordinary search alone', async () => {
  const route = await readFile(`${repoRoot}/apps/web/app/api/chat/route.ts`, 'utf8');
  const tools = await readFile(`${repoRoot}/apps/web/app/api/chat/tools.ts`, 'utf8');

  expect(route).toContain('queryVideoKnowledge: allTools.queryVideoKnowledge');
  expect(route).toContain('planVideoInvestigation: allTools.planVideoInvestigation');
  expect(route).toContain('inspectVideoKnowledge: allTools.inspectVideoKnowledge');
  expect(route).toContain('Treat only returned active evidence as source truth');
  expect(tools).toContain("'queryVideoKnowledge'");
  expect(tools).toContain('planVideoInvestigation: tool');
  expect(tools).toContain("'inspectVideoKnowledge'");
  expect(tools).toContain('Smart video evidence is available');
});

test('embeds one verified supporting clip and keeps the complete evidence list in sources', async () => {
  const citations = await readFile(
    `${repoRoot}/apps/web/components/chat/tools/video-evidence-result.tsx`,
    'utf8',
  );
  const preview = await readFile(
    `${repoRoot}/apps/web/components/chat/tools/chat-media-preview.tsx`,
    'utf8',
  );

  expect(citations).toContain("output.verification?.status === 'supported'");
  expect(citations).toContain('Supporting clip');
  expect(citations).toContain('Sources');
  expect(citations).toContain('ChatMediaPreview');
  expect(citations).not.toContain('Choose a moment');
  expect(citations).not.toContain('selectedEvidenceId');
  expect(citations).not.toContain('framePreviewUrl');
  expect(citations).not.toContain('displaySummary');
  expect(preview).toContain('getProviderEmbedUrl');
  expect(preview).toContain('youtube-nocookie.com/embed');
  expect(preview).toContain('player.vimeo.com/video');
});

test('indexes any fetched source transcript before paid audio transcription', async () => {
  const processRoute = await readFile(
    `${repoRoot}/apps/web/app/api/media/process/route.ts`,
    'utf8',
  );
  const importer = await readFile(
    `${repoRoot}/packages/tools/video-audio/src/url-importer.ts`,
    'utf8',
  );

  expect(processRoute).toContain(
    'const hasSourceTranscript = Boolean(sourceTranscript?.chunks?.length);',
  );
  expect(processRoute).toContain('skipAudioExtraction: hasSourceTranscript');
  expect(processRoute).toContain('no audio transcription was needed');
  expect(importer).toContain('getCachedYouTubeTranscript');
  expect(importer).toContain('youtubeTranscriptCache');
});
