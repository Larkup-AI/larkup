import { LarkupClient } from '@larkup/sdk';

const client = new LarkupClient({
  baseUrl: process.env.LARKUP_API_URL ?? 'http://localhost:8091',
  apiKey: process.env.LARKUP_API_KEY ?? 'sk-1ad8b2881d665aa0eadb66e5c13d74b336bbc8736079b196',
});

const indexedIds: string[] = [];
let indexingFailures = 0;

try {
  const health = await client.health();
  console.log(`Connected to ${health.service ?? 'Larkup'}: ${health.ok}`);
  await client.listDocuments(1, 1);
  console.log('Authentication verified');

  for await (const progress of client.indexDocuments(
    [
      {
        title: 'TypeScript SDK demo',
        text: 'Larkup turns documents into a searchable RAG knowledge base.',
      },
      {
        title: 'TypeScript SDK progress',
        text: 'The SDK can index sequentially or in parallel and stream progress.',
      },
    ],
    { mode: 'parallel', concurrency: 2, continueOnError: true },
  )) {
    if (progress.id) indexedIds.push(progress.id);
    indexingFailures = progress.failed;
    if (progress.error) console.error(progress.error);
    console.log(
      `Indexing ${progress.percent}% (${progress.succeeded} succeeded, ${progress.failed} failed)`,
    );
  }

  if (indexingFailures > 0) throw new Error('One or more documents failed to index.');

  const results = await client.query('How does SDK indexing work?', 3);
  for (const hit of results.hits) {
    console.log(`${hit.score.toFixed(3)} ${hit.title}: ${hit.text}`);
  }

  const summary = await client.corpusSummary();
  console.log(`Corpus: ${summary.totalDocuments} indexed chunks`);

  for await (const event of client.chat('Summarize the SDK demo documents.')) {
    if (event.type === 'text-delta') process.stdout.write(event.text ?? '');
  }
  process.stdout.write('\n');
} finally {
  await Promise.all(indexedIds.map((id) => client.deleteDocument(id)));
}
