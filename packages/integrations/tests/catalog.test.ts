import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getIntegration,
  getIntegrationReader,
  integrations,
  isIntegrationId,
  pendingVerificationIntegrationIds,
  readyIntegrations,
} from '../src/index.js';

test('the data catalog exposes only supported read-only knowledge sources', () => {
  assert.deepEqual(
    readyIntegrations.map((integration) => integration.id),
    [
      'notion',
      'google-analytics',
      'google-calendar',
      'google-docs',
      'google-drive',
      'google-maps',
      'google-meet',
      'google-sheets',
      'google-slides',
      'slack',
      'github',
      'jira',
      'linear',
      'confluence',
    ],
  );
  for (const integration of readyIntegrations) {
    assert.ok(integration.oauth.clientIdEnv);
    assert.ok(integration.oauth.clientSecretEnv);
    assert.ok(integration.oauth.accessTokenEnv);
  }
});

test('catalog lookup guards arbitrary provider ids', () => {
  assert.equal(getIntegration('slack')?.name, 'Slack');
  assert.equal(isIntegrationId('google-drive'), true);
  assert.equal(isIntegrationId('stripe'), false);
});

test('Atlassian integrations request one shared scope set', () => {
  const jiraScopes = getIntegration('jira')!.oauth.scopes;
  const confluenceScopes = getIntegration('confluence')!.oauth.scopes;
  assert.deepEqual(jiraScopes, confluenceScopes);
  assert.deepEqual(jiraScopes, ['read:jira-work', 'read:page:confluence', 'offline_access']);
});

test('the full coming-soon catalog remains visible without enabling unfinished readers', () => {
  assert.ok(integrations.length > readyIntegrations.length);
  assert.ok(integrations.some((integration) => integration.id === 'airtable'));
  assert.ok(integrations.some((integration) => integration.id === 'zoom'));
  assert.equal(
    integrations.find((integration) => integration.id === 'zoom')?.status,
    'coming-soon',
  );
  assert.equal(getIntegrationReader('airtable'), undefined);
});

test('holds Google OAuth integrations as coming soon until verification and excludes removed providers', () => {
  assert.deepEqual(pendingVerificationIntegrationIds, [
    'google-analytics',
    'google-calendar',
    'google-docs',
    'google-drive',
    'google-maps',
    'google-meet',
    'google-sheets',
    'google-slides',
  ]);
  for (const id of pendingVerificationIntegrationIds) {
    assert.equal(
      integrations.find((integration) => integration.id === id)?.status,
      'coming-soon',
      id,
    );
    assert.ok(getIntegration(id), `${id} must retain its OAuth definition`);
  }
  for (const id of [
    'qdrant',
    'langdock',
    'langdock-docs',
    'metabase',
    'openregister',
    'microsoft-todo',
    'microsoft-viva-engage',
    'milvus',
    'wrike',
    'microsoft-dynamics-365',
    'monday',
    'confluence-data-center',
    'jira-data-center',
  ]) {
    assert.equal(
      integrations.some((integration) => integration.id === id),
      false,
      id,
    );
  }
});

test('every ready integration has a reader for fetching knowledge', () => {
  for (const integration of readyIntegrations) {
    const reader = getIntegrationReader(integration.id);
    assert.ok(reader, `${integration.id} must have a reader`);
    assert.equal(typeof reader.listResources, 'function');
    assert.equal(typeof reader.getResource, 'function');
  }
});

test('every provider reader normalizes a resource list', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('notion.com'))
      return Response.json({
        results: [
          {
            object: 'page',
            id: 'notion-page',
            url: 'https://notion.so/page',
            properties: { Name: { type: 'title', title: [{ plain_text: 'A page' }] } },
          },
        ],
      });
    if (url.includes('analyticsadmin.googleapis.com'))
      return Response.json({
        accountSummaries: [
          {
            displayName: 'Larkup',
            propertySummaries: [{ property: 'properties/123', displayName: 'Production' }],
          },
        ],
      });
    if (url.includes('calendar/v3'))
      return Response.json({ items: [{ id: 'event-id', summary: 'Planning' }] });
    if (url.includes('meet.googleapis.com'))
      return Response.json({
        conferenceRecords: [{ name: 'conferenceRecords/meeting-id', startTime: 'today' }],
      });
    if (url.includes('/ex/jira/'))
      return Response.json({
        issues: [
          {
            id: 'issue-id',
            key: 'LARK-1',
            fields: { summary: 'A Jira issue', status: { name: 'Open' } },
          },
        ],
      });
    if (url.includes('api.linear.app'))
      return Response.json({
        data: {
          issues: {
            nodes: [{ id: 'linear-issue', identifier: 'LAR-1', title: 'A Linear issue' }],
          },
        },
      });
    if (url.includes('googleapis.com/drive'))
      return Response.json({
        files: [{ id: 'drive-file', name: 'A file', mimeType: 'text/plain' }],
      });
    if (url.includes('slack.com'))
      return Response.json({ ok: true, channels: [{ id: 'channel', name: 'general' }] });
    if (url.includes('api.github.com'))
      return Response.json([
        { full_name: 'larkup/repo', html_url: 'https://github.com/larkup/repo' },
      ]);
    if (url.includes('accessible-resources')) return Response.json([{ id: 'cloud-id' }]);
    return Response.json({
      results: [{ id: 'page-id', title: 'A Confluence page', version: { when: 'today' } }],
    });
  };

  try {
    for (const integration of readyIntegrations) {
      const resources = await getIntegrationReader(integration.id)!.listResources('test-token');
      assert.equal(resources.length, 1, integration.id);
      assert.ok(resources[0].id, integration.id);
      assert.ok(resources[0].title, integration.id);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Google readers turn connected account data into importable text', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('analyticsdata.googleapis.com'))
      return Response.json({
        dimensionHeaders: [{ name: 'pageTitle' }],
        metricHeaders: [{ name: 'activeUsers' }],
        rows: [{ dimensionValues: [{ value: 'Home' }], metricValues: [{ value: '42' }] }],
      });
    if (url.includes('calendar/v3'))
      return Response.json({
        summary: 'Planning',
        start: { dateTime: '2026-08-04T09:00:00Z' },
        end: { dateTime: '2026-08-04T10:00:00Z' },
        description: 'Plan the launch',
      });
    if (url.includes('docs.googleapis.com'))
      return Response.json({
        body: { content: [{ paragraph: { elements: [{ textRun: { content: 'A document' } }] } }] },
      });
    if (url.includes('drive/v3/files/map-id'))
      return Response.json({ name: 'Travel map', description: 'Saved places' });
    if (url.includes('meet.googleapis.com'))
      return Response.json({
        name: 'conferenceRecords/meeting-id',
        startTime: '2026-08-04T09:00:00Z',
        endTime: '2026-08-04T10:00:00Z',
      });
    if (url.includes('sheets.googleapis.com'))
      return Response.json({
        sheets: [
          {
            properties: { title: 'Pipeline' },
            data: [
              {
                rowData: [{ values: [{ formattedValue: 'Prospect' }, { formattedValue: 'Acme' }] }],
              },
            ],
          },
        ],
      });
    if (url.includes('slides.googleapis.com'))
      return Response.json({
        slides: [
          {
            pageElements: [
              { shape: { text: { textElements: [{ textRun: { content: 'Launch plan' } }] } } },
            ],
          },
        ],
      });
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const resources = {
      'google-analytics': {
        id: 'properties/123',
        title: 'Analytics',
        metadata: { propertyName: 'properties/123' },
      },
      'google-calendar': { id: 'event-id', title: 'Planning' },
      'google-docs': { id: 'document-id', title: 'Doc' },
      'google-maps': { id: 'map-id', title: 'Map' },
      'google-meet': { id: 'conferenceRecords/meeting-id', title: 'Meet' },
      'google-sheets': { id: 'sheet-id', title: 'Sheet' },
      'google-slides': { id: 'slides-id', title: 'Slides' },
    } as const;
    const expectedContent = {
      'google-analytics': 'Home\t42',
      'google-calendar': 'Plan the launch',
      'google-docs': 'A document',
      'google-maps': 'Saved places',
      'google-meet': 'conferenceRecords/meeting-id',
      'google-sheets': 'Prospect\tAcme',
      'google-slides': 'Launch plan',
    } as const;

    for (const [integration, resource] of Object.entries(resources)) {
      const document = await getIntegrationReader(integration)!.getResource('test-token', resource);
      assert.match(
        document.content,
        new RegExp(expectedContent[integration as keyof typeof expectedContent]),
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Jira reader imports an issue using the shared Atlassian OAuth token', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('accessible-resources')) return Response.json([{ id: 'cloud-id' }]);
    return Response.json({
      key: 'LARK-1',
      fields: {
        project: { name: 'Larkup' },
        issuetype: { name: 'Task' },
        status: { name: 'Open' },
        description: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ text: 'Ship it' }] }],
        },
        comment: { comments: [] },
      },
    });
  };

  try {
    const document = await getIntegrationReader('jira')!.getResource('test-token', {
      id: 'cloud-id:issue-id',
      title: 'LARK-1: A Jira issue',
      metadata: { cloudId: 'cloud-id' },
    });
    assert.match(document.content, /Ship it/);
    assert.match(document.content, /Project: Larkup/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Atlassian readers use only sites that expose their product scope', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.includes('accessible-resources'))
      return Response.json([
        { id: 'jira-cloud', scopes: ['read:jira-work'] },
        { id: 'confluence-cloud', scopes: ['read:page:confluence'] },
      ]);
    if (url.includes('/ex/confluence/confluence-cloud/'))
      return Response.json({
        results: [{ id: 'page-id', title: 'A Confluence page', version: { when: 'today' } }],
      });
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const resources = await getIntegrationReader('confluence')!.listResources('test-token');
    assert.equal(resources[0].id, 'confluence-cloud:page-id');
    assert.ok(requestedUrls.every((url) => !url.includes('/ex/confluence/jira-cloud/')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Linear reader imports a connected user’s issue details', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      data: {
        issue: {
          identifier: 'LAR-1',
          description: 'Ship the Linear connection',
          state: { name: 'In Progress' },
          project: { name: 'Larkup' },
          comments: { nodes: [{ body: 'Looks good', user: { name: 'Abdelrahman' } }] },
        },
      },
    });
  try {
    const document = await getIntegrationReader('linear')!.getResource('test-token', {
      id: 'linear-issue',
      title: 'LAR-1: Linear connection',
    });
    assert.match(document.content, /Ship the Linear connection/);
    assert.match(document.content, /Project: Larkup/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
