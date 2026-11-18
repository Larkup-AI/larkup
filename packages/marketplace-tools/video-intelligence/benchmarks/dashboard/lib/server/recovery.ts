import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export function parseRecoveryCsv(text: string): Record<string, string>[] {
  const records: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if (c === '\n' && !quoted) {
      row.push(field.replace(/\r$/, ''));
      records.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (quoted) throw Error('Incomplete recovery CSV');
  if (field || row.length) records.push([...row, field.replace(/\r$/, '')]);
  const header = records.shift() ?? [];
  return records
    .filter((r) => r.some(Boolean))
    .map((r) => {
      if (r.length !== header.length) throw Error('Invalid recovery row');
      return Object.fromEntries(header.map((k, i) => [k, r[i]]));
    });
}

export async function readRecovery(
  runId: string,
  root = path.resolve(process.cwd(), '../results/multimodal/video-understanding'),
) {
  if (!/^run-[a-zA-Z0-9-]+$/.test(runId)) return null;
  const folders = await readdir(path.join(root, 'data'), { withFileTypes: true });
  for (const folder of folders.filter((f) => f.isDirectory()).reverse()) {
    const dir = path.join(root, 'data', folder.name);
    let baseline;
    try {
      baseline = JSON.parse(await readFile(path.join(dir, 'baseline.json'), 'utf8'));
    } catch (error: any) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (![baseline.latestRunId, baseline.pilotRunId].includes(runId)) continue;
    const rows = parseRecoveryCsv(await readFile(path.join(root, 'results.csv'), 'utf8'));
    const summary = JSON.parse(await readFile(path.join(dir, 'summary.json'), 'utf8'));
    const questions = baseline.questions as Record<string, { question: string; options: string[] }>;
    let retry: { state: string; readers: string[]; questionIds: Record<string, string[]> } | null =
      null;
    try {
      retry = JSON.parse(await readFile(path.join(dir, 'retry-status.json'), 'utf8'));
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }
    const models = summary.rows.map((s: any) => {
      const cells = rows.filter((r) => r.reader === s.reader);
      const correct = cells.filter((r) => r.cumulative_correct === 'True').length;
      if (
        cells.length !== s.total ||
        correct !== s.cumulativeCorrect ||
        new Set(cells.map((r) => r.question_id)).size !== s.total
      )
        throw Error('Recovery summary does not match result rows');
      return {
        reader: s.reader,
        total: s.total,
        correct,
        baselineCorrect: s.baselineCorrect,
        pending: retry?.state === 'running' ? (retry.questionIds[s.reader] ?? []).length : 0,
        failed: cells
          .filter((r) => r.cumulative_correct !== 'True')
          .map((r) => ({
            questionId: r.question_id,
            question: questions[r.question_id]?.question ?? r.question_id,
            options: questions[r.question_id]?.options ?? [],
            predicted: r.new_option || null,
            official: r.official_option,
            pending:
              retry?.state === 'running' &&
              (retry.questionIds[s.reader] ?? []).includes(r.question_id),
            answer: (() => {
              try {
                return JSON.parse(r.new_answer).explanation ?? '';
              } catch {
                return r.new_answer;
              }
            })(),
          })),
      };
    });
    return {
      runId,
      status: retry?.state === 'running' ? 'running' : 'completed',
      method: summary.method,
      models,
      baselineRunId: baseline.latestRunId,
      pilotRunId: baseline.pilotRunId,
    };
  }
  return null;
}
