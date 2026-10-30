import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractAnalysisPresentation,
  withAnalysisPresentationHelpers,
} from '@larkup/workspace-server/lib/chat/analysis-presentation';
import { buildMatchingAnalysisFallback } from '@larkup/workspace-server/lib/chat/matching-analysis-fallback';
import { validateAnalysisCompleteness } from '@larkup/workspace-server/lib/chat/analysis-completeness';

const request =
  'For the first 25 people from the list, make 3 matches. Every person can be suggested not more than 3 times.';

describe('buildMatchingAnalysisFallback', () => {
  it('prepares all 75 rows without pandas even when semantic overlap is zero', () => {
    const columns = [
      'Name',
      'Question: What are your current needs and what would you benefit from the most?',
      'Question 1: Knowledge & Expertise — What can you help others with?',
    ];
    const code = buildMatchingAnalysisFallback(request, {
      columns: columns.map((name) => ({ name })) as never,
      rowCount: 30,
    });
    expect(code).toBeTruthy();

    const directory = mkdtempSync(join(tmpdir(), 'larkup-matching-'));
    const csv = [
      columns.map((column) => JSON.stringify(column)).join(','),
      ...Array.from({ length: 30 }, (_, index) =>
        [
          JSON.stringify(`Person ${index + 1}`),
          JSON.stringify(`Need ${index % 7}`),
          JSON.stringify(`Offer ${(index + 3) % 7}`),
        ].join(','),
      ),
    ].join('\n');
    writeFileSync(join(directory, 'data.csv'), csv);
    const stdout = execFileSync('python3', ['-c', withAnalysisPresentationHelpers(code!, 25)], {
      cwd: directory,
      encoding: 'utf8',
    });
    const presentation = extractAnalysisPresentation(stdout).presentation;

    expect(presentation).toMatchObject({ kind: 'table', totalItems: 75, requestedItems: 25 });
    expect(validateAnalysisCompleteness(request, presentation)).toEqual({ valid: true });
  });

  it('handles every survey row, combined offer wording, email output, and balanced reuse', () => {
    const naturalRequest =
      'You have a data document listing 102 participants. For each person from the list, make 3 matches with other people from the list based on people\'s needs and offers - Question 2: Current Needs: "What would you benefit from most right now?" Question 3: "Anything else you\'d like to add? Share what you\'re bringing to the table or what you\'re looking for.". Each person should be matched with no more than 6 people in total: 3 times they might be a good match for someone, and 3 times they should be matched with someone. For every match, write a one-sentence explanation of why this is the best choice and mention their email. Other information is not important.';
    const columns = [
      'Name',
      'Email Address',
      'Question 2: Current Needs: "What would you benefit from most right now?"',
      "Question 3: \"Anything else you'd like to add? Share what you're bringing to the table or what you're looking for.\"",
    ];
    const code = buildMatchingAnalysisFallback(naturalRequest, {
      columns: columns.map((name) => ({ name })) as never,
      rowCount: 102,
    });
    expect(code).toBeTruthy();

    const directory = mkdtempSync(join(tmpdir(), 'larkup-matching-survey-'));
    const csv = [
      columns.map((column) => JSON.stringify(column)).join(','),
      ...Array.from({ length: 102 }, (_, index) =>
        [
          JSON.stringify(`Person ${index + 1}`),
          JSON.stringify(`person${index + 1}@example.test`),
          JSON.stringify(`Need ${index % 11}`),
          JSON.stringify(`Offer ${(index + 3) % 11}`),
        ].join(','),
      ),
    ].join('\n');
    writeFileSync(join(directory, 'data.csv'), csv);
    const stdout = execFileSync('python3', ['-c', withAnalysisPresentationHelpers(code!, 102)], {
      cwd: directory,
      encoding: 'utf8',
    });
    const presentation = extractAnalysisPresentation(stdout).presentation;

    expect(presentation).toMatchObject({
      kind: 'table',
      totalItems: 306,
      requestedItems: 102,
      complete: true,
      fileName: 'participant-matches.csv',
    });
    expect(presentation?.kind === 'table' && presentation.columns).toContain('Email');
    if (presentation?.kind === 'table') {
      const outgoing = new Map<string, number>();
      const incoming = new Map<string, number>();
      for (const row of presentation.rows) {
        expect(row.Email).toBe(`${String(row.Match).replace('Person ', 'person')}@example.test`);
        expect(String(row.Reason)).toMatch(/^[^.]+\.$/);
        outgoing.set(String(row.Participant), (outgoing.get(String(row.Participant)) ?? 0) + 1);
        incoming.set(String(row.Match), (incoming.get(String(row.Match)) ?? 0) + 1);
      }
      expect(outgoing.size).toBe(102);
      expect([...outgoing.values()]).toEqual(Array.from({ length: 102 }, () => 3));
      expect(incoming.size).toBe(102);
      expect(Math.max(...incoming.values())).toBe(3);
    }
    expect(validateAnalysisCompleteness(naturalRequest, presentation, 102)).toEqual({
      valid: true,
    });
  });

  it('rebalances globally when greedy semantic choices would exhaust the final target', () => {
    const adversarialRequest =
      'For the first 8 people from the list, make 3 matches. Every person can be suggested not more than 3 times.';
    const columns = ['Name', 'Current Needs', 'What can you offer?'];
    const needs = ['t3 t6', 't0 t1 t2', 't5', 't1 t2 t5 t6', 't7', 't6', 't2 t3 t6 t7', ''];
    const offers = [
      't4 t7',
      't7',
      't6 t7',
      't0 t2 t3 t7',
      't2 t3 t6 t7',
      't4 t7',
      't0 t5 t7',
      't5 t7',
    ];
    const code = buildMatchingAnalysisFallback(adversarialRequest, {
      columns: columns.map((name) => ({ name })) as never,
      rowCount: 8,
    });
    expect(code).toBeTruthy();

    const directory = mkdtempSync(join(tmpdir(), 'larkup-matching-adversarial-'));
    const csv = [
      columns.map((column) => JSON.stringify(column)).join(','),
      ...needs.map((need, index) =>
        [
          JSON.stringify(`Person ${index + 1}`),
          JSON.stringify(need),
          JSON.stringify(offers[index]),
        ].join(','),
      ),
    ].join('\n');
    writeFileSync(join(directory, 'data.csv'), csv);
    const stdout = execFileSync('python3', ['-c', withAnalysisPresentationHelpers(code!, 8)], {
      cwd: directory,
      encoding: 'utf8',
    });
    const presentation = extractAnalysisPresentation(stdout).presentation;

    expect(presentation).toMatchObject({ kind: 'table', totalItems: 24, requestedItems: 8 });
    expect(validateAnalysisCompleteness(adversarialRequest, presentation, 8)).toEqual({
      valid: true,
    });
  });

  it('honors a reuse cap smaller than the matches per target when enough candidates exist', () => {
    const constrainedRequest =
      'For the first 8 people from the list, make 2 matches. Every person can be suggested at most 1 time.';
    const columns = ['Profile Label', 'Prompt Alpha', 'Prompt Beta'];
    const code = buildMatchingAnalysisFallback(constrainedRequest, {
      columns: columns.map((name) => ({ name })) as never,
      rowCount: 16,
    });
    expect(code).toBeTruthy();

    const directory = mkdtempSync(join(tmpdir(), 'larkup-matching-cap-'));
    const csv = [
      columns.map((column) => JSON.stringify(column)).join(','),
      ...Array.from({ length: 16 }, (_, index) =>
        [
          JSON.stringify(`Profile ${index + 1}`),
          JSON.stringify(index % 2 ? '' : `Topic ${index % 5}`),
          JSON.stringify(index % 3 ? `Skill ${(index + 1) % 5}` : ''),
        ].join(','),
      ),
    ].join('\n');
    writeFileSync(join(directory, 'data.csv'), csv);
    const stdout = execFileSync('python3', ['-c', withAnalysisPresentationHelpers(code!, 8)], {
      cwd: directory,
      encoding: 'utf8',
    });
    const presentation = extractAnalysisPresentation(stdout).presentation;

    expect(presentation).toMatchObject({ kind: 'table', totalItems: 16, requestedItems: 8 });
    if (presentation?.kind === 'table') {
      const incoming = new Map<string, number>();
      for (const row of presentation.rows) {
        incoming.set(String(row.Match), (incoming.get(String(row.Match)) ?? 0) + 1);
      }
      expect(Math.max(...incoming.values())).toBe(1);
    }
    expect(validateAnalysisCompleteness(constrainedRequest, presentation, 16)).toEqual({
      valid: true,
    });
  });

  it('completes a large survey with duplicate names, blank answers, and arbitrary extra fields', () => {
    const largeRequest =
      'For all 258 participants, make 3 matches. Every participant can be suggested no more than 3 times.';
    const columns = [
      'name',
      'created_at',
      'approval_status',
      'Your company / organisation',
      'Question 1: Knowledge & Expertise "Where can you help others with your experience?',
      'Question 2: Current Needs: "What would you benefit from most right now?"',
      'Question 3: "Anything else you would like to add?"',
    ];
    const code = buildMatchingAnalysisFallback(largeRequest, {
      columns: columns.map((name) => ({ name })) as never,
      rowCount: 258,
    });
    expect(code).toBeTruthy();

    const directory = mkdtempSync(join(tmpdir(), 'larkup-matching-large-'));
    const csv = [
      columns.map((column) => JSON.stringify(column)).join(','),
      ...Array.from({ length: 258 }, (_, index) =>
        [
          JSON.stringify(index < 2 ? 'Duplicate Person' : `Person ${index + 1}`),
          JSON.stringify('2026-10-30'),
          JSON.stringify('approved'),
          JSON.stringify(`Company ${index % 13}`),
          JSON.stringify(index % 11 === 0 ? '' : `Expertise ${index % 17}`),
          JSON.stringify(index % 7 === 0 ? '' : `Need ${(index + 4) % 17}`),
          JSON.stringify(index % 5 === 0 ? '' : `Additional context ${index % 19}`),
        ].join(','),
      ),
    ].join('\n');
    writeFileSync(join(directory, 'data.csv'), csv);
    const stdout = execFileSync('python3', ['-c', withAnalysisPresentationHelpers(code!, 258)], {
      cwd: directory,
      encoding: 'utf8',
    });
    const presentation = extractAnalysisPresentation(stdout).presentation;

    expect(presentation).toMatchObject({ kind: 'table', totalItems: 774, requestedItems: 258 });
    expect(validateAnalysisCompleteness(largeRequest, presentation, 258)).toEqual({ valid: true });
  });
});
