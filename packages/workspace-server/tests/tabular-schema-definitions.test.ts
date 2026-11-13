import assert from 'node:assert/strict';
import test from 'node:test';
import { tabularSchemaDefinitions } from '../src/lib/chat/tabular-schema-definitions';

test('a matching resource supplies field definitions without conflating other files', () => {
  const datasets = [
    {
      id: 'assets',
      fileName: 'assets.csv',
      columns: [{ name: 'company' }, { name: 'network_operator' }],
    },
  ];
  const documents = [
    {
      title: 'dictionary.json',
      content: JSON.stringify({
        resources: [
          {
            path: 'assets.csv',
            schema: {
              fields: [
                { name: 'company', description: 'Entity operating the asset' },
                {
                  name: 'network_operator',
                  description: 'Operator of the connected infrastructure',
                },
              ],
            },
          },
          {
            path: 'other.csv',
            schema: { fields: [{ name: 'company', description: 'Wrong source definition' }] },
          },
        ],
      }),
    },
  ];
  const definitions = tabularSchemaDefinitions(datasets, documents).get('assets');
  assert.match(definitions?.get('company') ?? '', /operating the asset/);
  assert.match(definitions?.get('network_operator') ?? '', /connected infrastructure/);
  assert.ok(!definitions?.get('company')?.includes('Wrong'));
});

test('malformed dictionaries do not prevent ordinary table analysis', () => {
  assert.equal(tabularSchemaDefinitions([], [{ title: 'bad.json', content: '{oops' }]).size, 0);
});

test('a late uploaded dictionary remains available after hundreds of JSON sources', () => {
  const docs = Array.from({ length: 250 }, () => ({ title: 'unrelated.json', content: '{}' }));
  docs.push({
    title: 'definitions.json',
    content: JSON.stringify({
      resources: [
        { path: 'assets.csv', schema: { fields: [{ name: 'owner', description: 'Legal owner' }] } },
      ],
    }),
  });
  assert.match(
    tabularSchemaDefinitions(
      [{ id: 'assets', fileName: 'assets.csv', columns: [{ name: 'owner' }] }],
      docs,
    )
      .get('assets')
      ?.get('owner') ?? '',
    /Legal owner/,
  );
});

test('dictionary units and enumerated statuses remain evidence without a description', () => {
  const definitions = tabularSchemaDefinitions(
    [{ id: 'a', fileName: 'a.csv', columns: [{ name: 'size' }, { name: 'status' }] }],
    [
      {
        title: 'dict.json',
        content: JSON.stringify({
          resources: [
            {
              path: 'a.csv',
              schema: {
                fields: [
                  { name: 'size', unit: 'MW' },
                  { name: 'status', constraints: { enum: ['active', 'retired'] } },
                ],
              },
            },
          ],
        }),
      },
    ],
  );
  assert.match(definitions.get('a')?.get('size') ?? '', /MW/);
  assert.match(definitions.get('a')?.get('status') ?? '', /active.*retired/);
});
