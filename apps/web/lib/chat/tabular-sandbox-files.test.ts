import { describe, expect, it } from 'vitest';
import type { TabularDataset } from '@larkup/core/tabular-store';
import {
  createTabularSandboxFiles,
  remapLegacyMultiDatasetReads,
  remapSingleDatasetColumnReferences,
  remapSingleDatasetRead,
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

  it('quotes form-export headers that contain commas and quotes', () => {
    const source = dataset('survey', 'survey.csv', [{ Name: 'Ada', Amount: 42 }]);
    source.columns[0].name = 'Question 1: Skills, "What can you offer?"';
    source.rows = [{ 'Question 1: Skills, "What can you offer?"': 'Fundraising', Amount: 42 }];

    expect(tabularDatasetToCsv(source)).toBe(
      '"Question 1: Skills, ""What can you offer?""",Amount\nFundraising,42',
    );
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

describe('remapSingleDatasetRead', () => {
  it('repoints a literal upload filename to the staged data.csv', () => {
    expect(remapSingleDatasetRead("data = pd.read_csv('participants.csv')")).toBe(
      "data = pd.read_csv('data.csv')",
    );
  });

  it('repoints a filename variable and leaves later generated-file reads alone', () => {
    expect(
      remapSingleDatasetRead(
        "source = pd.read_csv(filename)\nresult = pd.read_csv('generated.csv')",
      ),
    ).toBe("source = pd.read_csv('data.csv')\nresult = pd.read_csv('generated.csv')");
  });
});

describe('remapSingleDatasetColumnReferences', () => {
  it('maps an unambiguous long suffix to the exact exported form column', () => {
    const source = dataset('participants', 'participants.csv', []);
    source.columns.push({
      name: 'Pre-Matching (optional) Question 1: Knowledge & Expertise "Where can you help others with your experience?"',
      type: 'string',
      nullCount: 0,
      uniqueCount: 0,
    });
    const authored =
      'Question 1: Knowledge & Expertise "Where can you help others with your experience?"';
    const code = `expertise = data[${JSON.stringify(authored)}]`;

    expect(remapSingleDatasetColumnReferences(code, source)).toBe(
      `expertise = data[${JSON.stringify(source.columns[2].name)}]`,
    );
  });

  it('does not guess when a suffix identifies multiple columns', () => {
    const source = dataset('survey', 'survey.csv', []);
    source.columns.push(
      { name: 'Registration: Current Needs', type: 'string', nullCount: 0, uniqueCount: 0 },
      { name: 'Follow-up: Current Needs', type: 'string', nullCount: 0, uniqueCount: 0 },
    );
    const code = `needs = data['Current Needs and priorities']`;

    expect(remapSingleDatasetColumnReferences(code, source)).toBe(code);
  });

  it('repairs exact schema references whose apostrophes break generated Python quoting', () => {
    const source = dataset('survey', 'survey.csv', []);
    const column =
      'Question 3: "Anything else you\'d like to add? Share what you\'re bringing to the table."';
    source.columns.push({ name: column, type: 'string', nullCount: 0, uniqueCount: 0 });

    expect(remapSingleDatasetColumnReferences(`offers = data['${column}']`, source)).toBe(
      `offers = data[${JSON.stringify(column)}]`,
    );
  });
});
