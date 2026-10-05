import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { PDFDocument } from 'pdf-lib';
import {
  answerScopedDataExportSource,
  createDataExport,
  dataExportNeedsFreshData,
  dataExportUsesAnswerText,
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

  it('distinguishes direct exports from requests that require fresh filtering', () => {
    expect(dataExportNeedsFreshData('Can you create a PDF out of this list?')).toBe(false);
    expect(
      dataExportNeedsFreshData('This answer is good. Create a PDF with this last answer only.'),
    ).toBe(false);
    expect(dataExportNeedsFreshData('Export only rows where Country is Germany to Excel.')).toBe(
      true,
    );
    expect(
      dataExportNeedsFreshData('Give me a PDF with the 25 matches for those first 25 people.'),
    ).toBe(true);
  });

  it('distinguishes an answer/list export from an authoritative table export', () => {
    expect(dataExportUsesAnswerText('Create a PDF out of this list.')).toBe(true);
    expect(dataExportUsesAnswerText('Export the last answer only.')).toBe(true);
    expect(dataExportUsesAnswerText('Export this filtered data to Excel.')).toBe(false);
    expect(dataExportUsesAnswerText('Download the results as a PDF.')).toBe(false);
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

  it('keeps a long answer cell across multiple PDF pages instead of truncating it', async () => {
    const artifact = await createDataExport({
      format: 'pdf',
      title: 'Complete answer',
      columns: ['Answer'],
      rows: [{ Answer: Array.from({ length: 1_000 }, (_, index) => `detail-${index}`).join(' ') }],
    });
    const document = await PDFDocument.load(Buffer.from(artifact.fileBase64, 'base64'));
    expect(document.getPageCount()).toBeGreaterThan(1);
    expect(artifact.rowCount).toBe(1);
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

  it('exports every section of a rendered matching list as its own row', async () => {
    const answer = Array.from({ length: 25 }, (_, index) =>
      [
        `**Person ${index + 1}**`,
        `Needs: Topic ${index + 1}`,
        '',
        `- Match A${index + 1} - relevant expertise`,
        `- Match B${index + 1} - complementary experience`,
      ].join('\n'),
    ).join('\n\n---\n\n');

    const source = answerScopedDataExportSource({ answerText: answer });
    expect(source?.rows).toHaveLength(25);
    expect(source?.rows[0]).toEqual({
      Answer:
        'Person 1\nNeeds: Topic 1\n\n- Match A1 - relevant expertise\n- Match B1 - complementary experience',
    });
    expect(source?.rows[24].Answer).toContain('Person 25');

    const spreadsheet = await createDataExport({
      format: 'xlsx',
      title: 'Matches',
      ...source!,
    });
    const workbook = XLSX.read(Buffer.from(spreadsheet.fileBase64, 'base64'));
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.Answer!)).toHaveLength(25);

    const pdf = await createDataExport({ format: 'pdf', title: 'Matches', ...source! });
    expect(pdf.rowCount).toBe(25);
  });

  it('falls back to the complete bounded query result instead of an arbitrary first page', async () => {
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
    expect(source?.rows).toHaveLength(100);

    const csv = await createDataExport({ format: 'csv', title: 'Answer', ...source! });
    const csvLines = Buffer.from(csv.fileBase64, 'base64')
      .toString('utf8')
      .replace(/^\uFEFF/, '')
      .split('\r\n');
    expect(csv.rowCount).toBe(100);
    expect(csvLines).toHaveLength(101);

    const pdf = await createDataExport({ format: 'pdf', title: 'Answer', ...source! });
    expect(pdf.rowCount).toBe(100);
    expect(Buffer.from(pdf.fileBase64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('prefers authoritative current-turn data over model-copied or previous rows', () => {
    expect(
      selectDataExportSource({
        currentTurnTable: {
          columns: ['Value'],
          rows: [{ Value: 'current 1' }, { Value: 'current 2' }],
        },
        explicitTable: { columns: ['Value'], rows: [{ Value: 'current 1' }] },
        recentTable: { columns: ['Value'], rows: [{ Value: 'previous' }] },
      }),
    ).toEqual({
      columns: ['Value'],
      rows: [{ Value: 'current 1' }, { Value: 'current 2' }],
    });
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
