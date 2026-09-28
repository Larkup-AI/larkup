import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  answerScopedDataExportSource,
  createDataExport,
  requestedDataExportFormat,
  selectDataExportSource,
} from './data-export';
import { normalizeTableData, plainTableLabel } from './table-presentation';

describe('chat data exports', () => {
  it('recognizes direct file-format follow-ups without treating ordinary PDF questions as exports', () => {
    expect(requestedDataExportFormat('Can you export this data in pdf format?')).toBe('pdf');
    expect(requestedDataExportFormat('In excel table maybe?')).toBe('xlsx');
    expect(requestedDataExportFormat('In an Excel table, please.')).toBe('xlsx');
    expect(requestedDataExportFormat('What does the PDF say about renewal?')).toBeUndefined();
  });

  it('removes markdown from headers while preserving distinct columns', () => {
    expect(plainTableLabel('**Name**')).toBe('Name');
    expect(
      normalizeTableData(
        ['**Name**', '__Name__', '`Organization`'],
        [{ '**Name**': 'Ada', __Name__: 'Lovelace', '`Organization`': 'Analytical Engine' }],
      ),
    ).toEqual({
      columns: ['Name', 'Name (2)', 'Organization'],
      rows: [{ Name: 'Ada', 'Name (2)': 'Lovelace', Organization: 'Analytical Engine' }],
    });
  });

  it('creates a real Excel workbook with clean answer headers', async () => {
    const artifact = await createDataExport({
      format: 'xlsx',
      title: 'Participant answer',
      columns: ['**Name**', '**Organization**'],
      rows: [{ '**Name**': 'Ada Lovelace', '**Organization**': 'Analytical Engine' }],
    });
    const workbook = XLSX.read(Buffer.from(artifact.fileBase64, 'base64'));
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Answer!);
    expect(artifact.fileName).toBe('Participant-answer.xlsx');
    expect(rows).toEqual([{ Name: 'Ada Lovelace', Organization: 'Analytical Engine' }]);
  });

  it('creates a valid PDF artifact', async () => {
    const artifact = await createDataExport({
      format: 'pdf',
      title: 'Participant answer',
      columns: ['**Name**'],
      rows: [{ '**Name**': 'Ada Lovelace' }],
    });
    expect(Buffer.from(artifact.fileBase64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('exports only rows explicitly included in the answer', () => {
    const source = answerScopedDataExportSource({
      table: {
        columns: ['University', 'Cost'],
        rows: Array.from({ length: 100 }, (_, index) => ({
          University: `Campus ${index + 1}`,
          Cost: index + 1,
        })),
      },
      answerText: 'The relevant results are Campus 4 and Campus 19.',
    });

    expect(source?.rows).toEqual([
      { University: 'Campus 4', Cost: 4 },
      { University: 'Campus 19', Cost: 19 },
    ]);
  });

  it('uses the exact Markdown table rendered in an answer', () => {
    const source = answerScopedDataExportSource({
      table: {
        columns: ['University', 'Cost'],
        rows: Array.from({ length: 100 }, (_, index) => ({
          University: `Campus ${index + 1}`,
          Cost: index + 1,
        })),
      },
      answerText: [
        'Here are the requested rows:',
        '',
        '| University | Cost |',
        '| --- | ---: |',
        '| Campus 8 | €8m |',
        '| Campus 11 | €11m |',
      ].join('\n'),
    });

    expect(source).toEqual({
      columns: ['University', 'Cost'],
      rows: [
        { University: 'Campus 8', Cost: '€8m' },
        { University: 'Campus 11', Cost: '€11m' },
      ],
    });
  });

  it('falls back to the same first 10 rows initially shown by the chat table', async () => {
    const source = answerScopedDataExportSource({
      table: {
        columns: ['University', 'Cost'],
        rows: Array.from({ length: 100 }, (_, index) => ({
          University: `Campus ${index + 1}`,
          Cost: index + 1,
        })),
      },
      answerText: 'These are the strongest results from the analysis.',
    });
    expect(source?.rows).toHaveLength(10);

    const csv = await createDataExport({ format: 'csv', title: 'Answer', ...source! });
    const csvLines = Buffer.from(csv.fileBase64, 'base64')
      .toString('utf8')
      .replace(/^\uFEFF/, '')
      .split('\r\n');
    expect(csv.rowCount).toBe(10);
    expect(csvLines).toHaveLength(11);

    const pdf = await createDataExport({ format: 'pdf', title: 'Answer', ...source! });
    expect(pdf.rowCount).toBe(10);
    expect(Buffer.from(pdf.fileBase64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('prefers explicitly bounded rows, then current-turn data, over previous tables', () => {
    expect(
      selectDataExportSource({
        currentTurnTable: {
          columns: ['Value'],
          rows: [{ Value: 'current 1' }, { Value: 'current 2' }],
        },
        explicitTable: { columns: ['Value'], rows: [{ Value: 'current 1' }] },
        recentTable: { columns: ['Value'], rows: [{ Value: 'previous' }] },
      }),
    ).toEqual({ columns: ['Value'], rows: [{ Value: 'current 1' }] });
    expect(
      selectDataExportSource({
        currentTurnTable: { columns: ['Value'], rows: [{ Value: 'current' }] },
        recentTable: { columns: ['Value'], rows: [{ Value: 'previous' }] },
      }),
    ).toEqual({ columns: ['Value'], rows: [{ Value: 'current' }] });
  });

  it('exports a non-tabular answer as one answer row', () => {
    expect(answerScopedDataExportSource({ answerText: 'The renewal date is 1 January.' })).toEqual({
      columns: ['Answer'],
      rows: [{ Answer: 'The renewal date is 1 January.' }],
    });
  });
});
