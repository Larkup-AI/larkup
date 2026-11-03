import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  extractAnalysisPresentation,
  withAnalysisPresentationHelpers,
} from '../src/lib/chat/analysis-presentation.ts';
import { validateAnalysisCompleteness } from '../src/lib/chat/analysis-completeness.ts';
import { buildMatchingAnalysisFallback } from '../src/lib/chat/matching-analysis-fallback.ts';

test('range matching filters eligibility and validates every target at 1,000 rows', () => {
  const request = `You have a dataset of 1000 registered participants. For each eligible participant, find 2-5 best matches based on Current Needs and Knowledge & Expertise. Each person can be recommended to others a maximum of 5 times. No self-matching or duplicate matches. Apply these limits globally across the entire dataset. Include name, email, company/organisation, LinkedIn link and one specific reason.`;
  const columns = [
    'participant_number',
    'name',
    'email',
    'company / organisation',
    'linkedin_click_id',
    'Share your LinkedIn profile with us (optional)',
    'opted in',
    'approval_status',
    'Question 1: Knowledge & Expertise: Where can you help others?',
    'Question 2: Current Needs: What would you benefit from most right now?',
    "Question 3: Anything else you'd like to add? Share what you're bringing to the table or what you're looking for.",
  ];
  const code = buildMatchingAnalysisFallback(request, {
    columns: columns.map((name) => ({ name })) as never,
    rowCount: 1_000,
  });
  assert.ok(code);

  const directory = mkdtempSync(join(tmpdir(), 'larkup-matching-scale-'));
  const csv = [
    columns.map((column) => JSON.stringify(column)).join(','),
    ...Array.from({ length: 1_000 }, (_, index) =>
      [
        index + 1,
        JSON.stringify(`Person ${index + 1}`),
        JSON.stringify(`person${index + 1}@example.test`),
        JSON.stringify(`Company ${index % 41}`),
        JSON.stringify(`tracking-${index + 1}`),
        JSON.stringify(`https://linkedin.example/person-${index + 1}`),
        index < 800 ? 'yes' : 'no',
        'approved',
        JSON.stringify(`Fundraising investor outreach topic ${index % 37}`),
        JSON.stringify(`Finding investors fundraising strategy topic ${(index + 3) % 37}`),
        JSON.stringify(`Can introduce founders and advise on topic ${(index + 7) % 37}`),
      ].join(','),
    ),
  ].join('\n');
  writeFileSync(join(directory, 'data.csv'), csv);

  const stdout = execFileSync('python3', ['-c', withAnalysisPresentationHelpers(code, 1_000)], {
    cwd: directory,
    encoding: 'utf8',
    maxBuffer: 10_000_000,
    timeout: 120_000,
  });
  const presentation = extractAnalysisPresentation(stdout).presentation;
  assert.equal(presentation?.kind, 'table');
  assert.equal(presentation?.requestedItems, 800);
  assert.equal(presentation?.complete, true);
  assert.deepEqual(validateAnalysisCompleteness(request, presentation, 1_000), { valid: true });

  if (presentation?.kind !== 'table') return;
  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();
  for (const row of presentation.rows) {
    const participant = String(row.Participant);
    const match = String(row.Match);
    assert.notEqual(participant, match);
    assert.ok(Number(participant.replace('Person ', '')) <= 800);
    assert.match(String(row['Participant Email']), /@example\.test$/);
    assert.match(String(row['Match Email']), /@example\.test$/);
    assert.match(String(row['Participant LinkedIn']), /^https:\/\/linkedin\.example\//);
    assert.match(String(row['Match LinkedIn']), /^https:\/\/linkedin\.example\//);
    assert.doesNotMatch(String(row['Participant LinkedIn']), /^tracking-/);
    assert.doesNotMatch(String(row['Match LinkedIn']), /^tracking-/);
    assert.match(
      String(row.Reason),
      /^Person \d+ is a good match for you because they can support you with fundraising and investor outreach, which directly aligns with your current needs\.$/,
    );
    assert.doesNotMatch(String(row.Reason), /\bstated\b/i);
    assert.doesNotMatch(String(row.Reason), /[\"“”]|topic \d+/i);
    outgoing.set(participant, (outgoing.get(participant) ?? 0) + 1);
    incoming.set(match, (incoming.get(match) ?? 0) + 1);
  }
  assert.equal(outgoing.size, 800);
  assert.ok([...outgoing.values()].every((count) => count >= 2 && count <= 5));
  assert.ok([...incoming.values()].every((count) => count <= 5));
});
