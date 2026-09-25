import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { createDataExport, requestedDataExportFormat } from './data-export';
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
});
