import { openAsBlob } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    endpoint: { type: 'string' },
    runtime: { type: 'string', default: 'cloud' },
    file: { type: 'string' },
    output: { type: 'string' },
    duration: { type: 'string' },
    mode: { type: 'string', default: 'balanced' },
    language: { type: 'string', default: 'auto' },
    key: { type: 'string' },
    question: { type: 'string' },
    'range-start': { type: 'string' },
    'range-end': { type: 'string' },
    'max-frames': { type: 'string' },
    continuous: { type: 'boolean', default: false },
  },
});

if (!values.endpoint || !values.file || !values.output || !values.duration) {
  throw new Error('--endpoint, --file, --output, and --duration are required');
}
if (!['fast', 'balanced', 'thorough'].includes(values.mode)) {
  throw new Error('--mode must be fast, balanced, or thorough');
}
if (!values.language.trim()) {
  throw new Error('--language must be auto or a non-empty language code');
}

const hasRange = values['range-start'] !== undefined || values['range-end'] !== undefined;
const rangeStart = Number(values['range-start']);
const rangeEnd = Number(values['range-end']);
if (
  hasRange &&
  (!Number.isFinite(rangeStart) ||
    !Number.isFinite(rangeEnd) ||
    rangeStart < 0 ||
    rangeEnd <= rangeStart)
) {
  throw new Error('--range-start and --range-end must form a finite increasing range');
}
const maxFrames = values['max-frames'] === undefined ? undefined : Number(values['max-frames']);
if (maxFrames !== undefined && (!Number.isInteger(maxFrames) || maxFrames < 1 || maxFrames > 24)) {
  throw new Error('--max-frames must be an integer between 1 and 24');
}

const endpoint = values.endpoint.replace(/\/$/, '');
let apiKey = values.key || '';
const startedAt = Date.now();

async function request(path, init = {}, anonymous = false) {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (apiKey && !anonymous) headers.set('Authorization', `Bearer ${apiKey}`);
  const response = await fetch(`${endpoint}${path}`, { ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.detail || body.error || `${path} returned HTTP ${response.status}`);
  }
  return body;
}

const health = await request('/v1/health');
if (health.status !== 'ok') throw new Error('runtime health check failed');

if (values.runtime === 'cloud' && !apiKey) {
  const provisioned = await request(
    '/v1/device-keys',
    { method: 'POST', body: JSON.stringify({ installationId: randomUUID() }) },
    true,
  );
  apiKey = provisioned.apiKey;
}

const blob = await openAsBlob(values.file, { type: 'video/mp4' });
let upload;
if (values.runtime === 'cloud') {
  upload = await request('/v1/uploads', {
    method: 'POST',
    body: JSON.stringify({
      fileName: 'validation-video.mp4',
      contentType: 'video/mp4',
      sizeBytes: blob.size,
    }),
  });
  const uploaded = await fetch(upload.uploadUrl, {
    method: 'PUT',
    headers: upload.uploadHeaders,
    body: blob,
  });
  if (!uploaded.ok) throw new Error(`source upload returned HTTP ${uploaded.status}`);
} else {
  const form = new FormData();
  form.append('file', blob, 'validation-video.mp4');
  upload = await request('/v1/uploads', { method: 'POST', body: form });
}

let job = await request('/v1/jobs', {
  method: 'POST',
  body: JSON.stringify({
    source: { uploadId: upload.uploadId, durationSecs: Number(values.duration) },
    brief: {
      indexingMode: values.mode,
      language: values.language.trim(),
      goal: values.question
        ? `Answer this question from direct timestamped source evidence: ${values.question}`
        : 'Build a clean timestamped account of the entities, visible and spoken state history, key events, and overall source context. Use only source evidence and do not assume a content genre.',
      expectedQuestions: values.question
        ? [values.question]
        : [
            'Who or what participated?',
            'How did the visible or spoken state change over time?',
            'What were the key events and the final context?',
          ],
      ...(hasRange
        ? {
            importantRanges: [
              { startSecs: rangeStart, endSecs: rangeEnd, note: 'bounded validation' },
            ],
            requireSemanticVision: true,
            skipVideoEmbeddings: true,
            continuousSequence: values.continuous,
            ...(maxFrames === undefined ? {} : { maxFrames }),
          }
        : {}),
    },
  }),
});

let lastProgress = '';
while (job.status === 'queued' || job.status === 'running') {
  const progressKey = JSON.stringify(job.progress);
  if (progressKey !== lastProgress) {
    const elapsedSecs = Math.round((Date.now() - startedAt) / 1000);
    process.stdout.write(
      `${JSON.stringify({ elapsedSecs, status: job.status, ...job.progress })}\n`,
    );
    lastProgress = progressKey;
  }
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  job = await request(`/v1/jobs/${encodeURIComponent(job.id)}`);
}

if (job.status !== 'completed') throw new Error(job.error || `job ended as ${job.status}`);
if (!job.result && job.resultUrl) {
  const response = await fetch(job.resultUrl);
  if (!response.ok) throw new Error(`result download returned HTTP ${response.status}`);
  job.result = await response.json();
}
if (!job.result) throw new Error('completed job did not contain a result');

const elapsedSecs = (Date.now() - startedAt) / 1_000;
await writeFile(
  values.output,
  JSON.stringify({ runtime: values.runtime, elapsedSecs, jobId: job.id, result: job.result }, null, 2),
  'utf8',
);
if (values.runtime === 'cloud') {
  await request(`/v1/jobs/${encodeURIComponent(job.id)}/result/ack`, {
    method: 'POST',
    body: '{}',
  }).catch(() => undefined);
}
process.stdout.write(`${JSON.stringify({ status: 'completed', elapsedSecs, output: values.output })}\n`);
