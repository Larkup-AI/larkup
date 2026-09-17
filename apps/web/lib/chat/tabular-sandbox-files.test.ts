import { describe, expect, it } from 'vitest';
import type { TabularDataset } from '@larkup/core/tabular-store';
import {
  createTabularSandboxFiles,
  remapLegacyMultiDatasetReads,
  tabularDatasetToCsv,
} from './tabular-sandbox-files';

function dataset(id: string, fileName: string, rows: Record<string, unknown>[]): TabularDataset {
  return {
    id,
    fileName,
    columns: [
      { name: 'Name', type: 'string', nullCount: 0, uniqueCount: rows.length },
      { name: 'Amount', type: 'number', nullCount: 0, uniqueCount: rows.length },
    ],
    rows,
    summary: {
      totalRows: rows.length,
      totalColumns: 2,
      numericColumns: 1,
      categoricalColumns: 1,
      dateColumns: 0,
    },
    rowCount: rows.length,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('tabular sandbox files', () => {
  it('preserves the legacy data.csv contract and safely escapes CSV text', () => {
    const source = dataset('orders', 'orders.csv', [{ Name: 'Desk, "Large"', Amount: 42 }]);

    expect(tabularDatasetToCsv(source)).toBe('Name,Amount\n"Desk, ""Large""",42');
    expect(createTabularSandboxFiles([source])).toEqual({
      files: [{ name: 'data.csv', content: 'Name,Amount\n"Desk, ""Large""",42' }],
    });
  });

  it('creates a manifest and distinct files for a cross-dataset analysis', () => {
    const orders = dataset('orders', 'Orders', [{ Name: 'CA-1', Amount: 20 }]);
    const returns = dataset('returns', 'Returns', [{ Name: 'CA-1', Amount: 1 }]);

    const staged = createTabularSandboxFiles([orders, returns]);

    expect(staged.files.map((file) => file.name)).toEqual([
      'dataset-1.csv',
      'dataset-2.csv',
      'datasets.json',
    ]);
    expect(staged.manifest).toEqual({
      datasets: [
        {
          id: 'orders',
          fileName: 'Orders',
          file: 'dataset-1.csv',
          rowCount: 1,
          columns: ['Name', 'Amount'],
        },
        {
          id: 'returns',
          fileName: 'Returns',
          file: 'dataset-2.csv',
          rowCount: 1,
          columns: ['Name', 'Amount'],
        },
      ],
    });
  });

  it('recovers exactly one legacy CSV read per selected dataset', () => {
    const code = [
      "orders = pd.read_csv('data.csv')",
      "returns = pd.read_csv('data.csv')",
      "people = pd.read_csv('data.csv')",
    ].join('\n');

    expect(remapLegacyMultiDatasetReads(code, 3)).toBe(
      [
        "orders = pd.read_csv('dataset-1.csv')",
        "returns = pd.read_csv('dataset-2.csv')",
        "people = pd.read_csv('dataset-3.csv')",
      ].join('\n'),
    );
    expect(remapLegacyMultiDatasetReads(code, 2)).toBe(code);
  });

  it('converts legacy Excel sheet reads to the staged CSV files', () => {
    const code = [
      "orders = pd.read_excel('data.csv', sheet_name='Orders')",
      "returns = pd.read_excel('data.csv', sheet_name='Returns')",
    ].join('\n');

    expect(remapLegacyMultiDatasetReads(code, 2)).toBe(
      ["orders = pd.read_csv('dataset-1.csv')", "returns = pd.read_csv('dataset-2.csv')"].join(
        '\n',
      ),
    );
  });
});
