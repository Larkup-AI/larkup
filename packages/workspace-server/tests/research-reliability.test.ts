import assert from 'node:assert/strict';
import test from 'node:test';
import { contextualizeKnowledgeFollowUpQuery } from '../src/lib/chat/conversation-memory';
import * as datasetRouting from '../src/lib/chat/tabular-dataset-routing';
import { compactToolContextForModel } from '../src/lib/chat/tool-context';

const emptyEvidence = { sources: [], images: [], mediaAssetIds: [] };

test('an elliptical follow-up keeps the previous question even after an empty failed answer', () => {
  const query = contextualizeKnowledgeFollowUpQuery(
    'why?',
    emptyEvidence,
    'Which variables describe regional demand and its prediction?',
  );
  assert.ok(query?.includes('regional demand'));
  assert.ok(query?.includes('why?'));
});

test('a self-contained short question does not inherit an unrelated source topic', () => {
  assert.equal(
    contextualizeKnowledgeFollowUpQuery(
      'What causes tidal currents?',
      {
        ...emptyEvidence,
        sources: [{ title: 'Warehouse guide', text: 'Inventory operations' }],
      },
      'What is the inventory balance?',
    ),
    undefined,
  );
});

test('query-relevant schemas survive hundreds of earlier uploads', () => {
  const datasets = Array.from({ length: 220 }, (_, i) => ({
    id: `dataset-${i}`,
    fileName: `upload-${i}.csv`,
    columns: [{ name: 'Record', type: 'string' }],
  }));
  datasets[219] = {
    id: 'target',
    fileName: 'facilities.csv',
    columns: [
      { name: 'Commissioned', type: 'date' },
      { name: 'Net_Capacity', type: 'number' },
    ],
  };
  const ranked = datasetRouting.rankTabularDatasetsForQuestion(
    'Sum Net_Capacity for facilities commissioned before 2000',
    datasets as any,
  );
  assert.equal(ranked[0].id, 'target');
  assert.equal(new Set(ranked.map((d) => d.id)).size, datasets.length);
});

test('failed execution output cannot become numerical answer evidence', () => {
  const compact = compactToolContextForModel([
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolName: 'executeAnalysis',
          output: {
            exitCode: 1,
            stdout: 'Revenue: 123456',
            stderr: 'Invalid grouping',
            presentation: { kind: 'table', complete: true, summary: 'Revenue: 123456' },
          },
        },
      ],
    },
  ]);
  assert.ok(!JSON.stringify(compact).includes('123456'));
  assert.ok(JSON.stringify(compact).includes('Invalid grouping'));
});

import { isLikelyTabularQuestion } from '../src/lib/chat/tabular-routing';
test('a schema word inside an unrelated word cannot select tabular analysis', () => {
  assert.equal(
    isLikelyTabularQuestion({
      text: 'Which variables describe electricity demand and its forecast?',
      columnNames: ['city', 'type', 'state'],
      datasetNames: ['facilities.csv'],
    }),
    false,
  );
  assert.equal(
    isLikelyTabularQuestion({
      text: 'Show capacity by city',
      columnNames: ['city', 'capacity'],
      datasetNames: ['facilities.csv'],
    }),
    true,
  );
});
import { requiresTabularSandbox } from '../src/lib/chat/tabular-routing';
import { remapMountedDatasetReads } from '../src/lib/chat/tabular-sandbox-files';

test('subset proportions and derived calendar buckets use complete-table code analysis', () => {
  assert.equal(
    requiresTabularSandbox(
      'What proportion of entries before 1985 are active? Show numerator and denominator.',
    ),
    true,
  );
  assert.equal(
    requiresTabularSandbox('Plot total rated power by commissioning decade and category'),
    true,
  );
});

test('a filename assigned to a Python variable resolves to the mounted source', () => {
  const code = "path = 'assets.csv'\nframe = pd.read_csv(path)";
  const manifest = {
    datasets: [
      { id: 'a', fileName: 'assets.csv', file: 'dataset-1.csv', rowCount: 2, columns: [] },
      { id: 'b', fileName: 'events.csv', file: 'dataset-2.csv', rowCount: 2, columns: [] },
    ],
    relationships: [],
  };
  assert.equal(
    remapMountedDatasetReads(code, manifest),
    "path = 'dataset-1.csv'\nframe = pd.read_csv(path)",
  );
});
test('an aggregate word cannot select an unrelated table over document evidence', () => {
  assert.equal(
    isLikelyTabularQuestion({
      text: 'What was the largest electricity generation source last year?',
      columnNames: ['city', 'status', 'capacity'],
      datasetNames: ['facilities.csv'],
    }),
    false,
  );
});
test('an incidental measure word is not a match for an unrelated compound schema field', () => {
  assert.equal(
    isLikelyTabularQuestion({
      text: 'What was maximum daily generation and can we infer its capacity factor?',
      columnNames: ['capacity_net_registry', 'efficiency_estimate'],
      datasetNames: ['facilities.csv'],
    }),
    false,
  );
});
import { documentResearchToolsForStep } from '../src/lib/chat/retrieval-routing';
test('document research can refine a missing clause without an unbounded search loop', () => {
  assert.deepEqual(documentResearchToolsForStep(0, ['searchKnowledgeBase', 'inspectPdfPages']), {
    toolChoice: 'auto',
    activeTools: ['searchKnowledgeBase', 'inspectPdfPages'],
  });
  assert.deepEqual(documentResearchToolsForStep(2, ['searchKnowledgeBase', 'inspectPdfPages']), {
    toolChoice: 'none',
    activeTools: [],
  });
});
test('ordinary retrieved chunks keep supporting values near their end', () => {
  const evidence = 'Context '.repeat(190) + 'The verified share is 64.25 percent.';
  const compact = compactToolContextForModel([
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolName: 'searchKnowledgeBase',
          output: { hits: [{ title: 'report.pdf', text: evidence }] },
        },
      ],
    },
  ]);
  assert.ok(JSON.stringify(compact).includes('64.25'));
});
test('exhaustive integrity checks and a winner per group require full-table operations', () => {
  assert.equal(requiresTabularSandbox('Which primary IDs are duplicated and how often?'), true);
  assert.equal(requiresTabularSandbox('Which category dominates the total in each region?'), true);
  assert.equal(requiresTabularSandbox('Find entries closed before their opening year.'), true);
});
test('independent rankings by two measures use complete-table analysis', () => {
  assert.equal(
    requiresTabularSandbox(
      'Which owner leads by record count and which leads by total volume, including ties?',
    ),
    true,
  );
});
test('a generic field name used as an instruction cannot force an unrelated table', () => {
  assert.equal(
    isLikelyTabularQuestion({
      text: 'Calculate the correlation and state whether raw paired observations are available.',
      columnNames: ['state', 'state', 'capacity'],
      numericColumnNames: ['capacity'],
      datasetNames: ['facilities.csv'],
    }),
    false,
  );
  assert.equal(
    isLikelyTabularQuestion({
      text: 'What is the highest demand?',
      columnNames: ['demand'],
      numericColumnNames: ['demand'],
      datasetNames: ['measurements.csv'],
    }),
    true,
  );
});

import { withFinalAnswerNudge } from '../src/lib/chat/tool-context';
test('complete structured results are summarized rather than restreamed into a token limit', () => {
  const result = withFinalAnswerNudge([
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          output: { type: 'json', value: { exitCode: 0, presentation: { complete: true } } },
        },
      ],
    },
  ]);
  assert.match(JSON.stringify(result.at(-1)), /do not repeat its rows/);
});

test('tabular reasoning honors the selected model', async () => {
  const { tabularToolPlannerModel } = await import('../src/lib/chat/tabular-routing');
  assert.equal(tabularToolPlannerModel(true, 'vendor/chosen'), 'vendor/chosen');
});

test('complete structured calculations stop before an unverified prose regeneration', async () => {
  const { shouldFinishStructuredAnalysis } = await import('../src/lib/chat/tabular-routing');
  const steps = [
    {
      toolResults: [
        { toolName: 'executeAnalysis', output: { exitCode: 0, presentation: { complete: true } } },
      ],
    },
  ];
  assert.equal(shouldFinishStructuredAnalysis(steps), true);
  assert.equal(shouldFinishStructuredAnalysis(steps, true), false);
  assert.equal(
    shouldFinishStructuredAnalysis([
      {
        toolResults: [
          {
            toolName: 'executeAnalysis',
            output: { exitCode: 1, presentation: { complete: true } },
          },
        ],
      },
    ]),
    false,
  );
});

test('a missing action object inherits context while an explicitly named object does not', () => {
  const evidence = {
    ...emptyEvidence,
    sources: [{ title: 'Workshop instructions', text: 'Registration opens next month.' }],
  };
  assert.match(
    contextualizeKnowledgeFollowUpQuery('How do I participate?', evidence) ?? '',
    /Registration opens/,
  );
  assert.equal(
    contextualizeKnowledgeFollowUpQuery('How do I access satellite archives?', evidence),
    undefined,
  );
});
