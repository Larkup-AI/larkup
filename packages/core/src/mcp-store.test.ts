import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import {
  MCP_SECRET_REDACTED,
  connectMcpConnection,
  mergeMcpConnection,
  namespaceMcpTools,
  redactMcpConnection,
  validateMcpHeaders,
  type McpConnection,
} from './mcp-store';

const connection: McpConnection = {
  id: 'mcp-1',
  name: 'Support',
  url: 'https://mcp.example.com/mcp',
  transport: 'http',
  connectionType: 'direct',
  headers: { Authorization: 'Bearer private-token', 'X-Tenant': 'acme' },
  enabled: true,
  enabledForLocalChat: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const proxyConnection: McpConnection = {
  ...connection,
  connectionType: 'proxy',
  proxyUrl: 'https://proxy.example.com/mcp',
  proxyAuthToken: 'proxy-private-token',
  proxyAuthHeader: 'X-Proxy-Authorization',
};

test('MCP connection safety: redacts credentials but leaves non-secret headers editable', () => {
  const redacted = redactMcpConnection(connection);
  assert.equal(redacted.headers.Authorization, MCP_SECRET_REDACTED);
  assert.equal(redacted.headers['X-Tenant'], 'acme');
  assert.doesNotMatch(JSON.stringify(redacted), /private-token/);
});

test('MCP connection safety: redacts the proxy auth token', () => {
  const redacted = redactMcpConnection(proxyConnection);
  assert.equal(redacted.proxyAuthToken, MCP_SECRET_REDACTED);
  assert.doesNotMatch(JSON.stringify(redacted), /proxy-private-token/);
});

test('MCP connection safety: keeps stored credentials when the UI returns the redaction sentinel', () => {
  const merged = mergeMcpConnection(connection, {
    name: 'Renamed support',
    headers: { Authorization: MCP_SECRET_REDACTED, 'X-Tenant': 'new-acme' },
  });
  assert.equal(merged.name, 'Renamed support');
  assert.equal(merged.headers.Authorization, 'Bearer private-token');
  assert.equal(merged.headers['X-Tenant'], 'new-acme');
});

test('MCP connection safety: keeps the proxy auth token when the UI returns the redaction sentinel', () => {
  const merged = mergeMcpConnection(proxyConnection, {
    proxyAuthToken: MCP_SECRET_REDACTED,
  });
  assert.equal(merged.proxyAuthToken, 'proxy-private-token');
});

test('MCP connection safety: rejects header injection and unsupported endpoint schemes', () => {
  assert.throws(
    () => validateMcpHeaders({ Authorization: 'Bearer ok\nInjected: no' }),
    /cannot contain a newline/,
  );
  assert.throws(() => mergeMcpConnection(connection, { url: 'file:///tmp/mcp' }), /HTTP\(S\)/);
  assert.throws(() => mergeMcpConnection(connection, { transport: 'stdio' as any }), /transport/);
  assert.throws(
    () => mergeMcpConnection(connection, { connectionType: 'proxy' }),
    /Proxy URL is required/,
  );
});

test('MCP tools are namespaced so they cannot replace built-in tools', () => {
  const remote = { searchKnowledgeBase: { description: 'Remote search' } };
  const namespaced = namespaceMcpTools(connection, remote);
  assert.deepEqual(Object.keys(namespaced), ['mcp_mcp1_searchKnowledgeBase']);
  assert.equal(namespaced.mcp_mcp1_searchKnowledgeBase, remote.searchKnowledgeBase);
});

test('MCP connection discovers tools through Streamable HTTP', async () => {
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }
    const raw = await new Promise<string>((resolve, reject) => {
      let value = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => (value += chunk));
      request.on('end', () => resolve(value));
      request.on('error', reject);
    });
    if (!raw) {
      response.writeHead(204).end();
      return;
    }
    const body = JSON.parse(raw) as { id?: number; method: string };

    if (body.method === 'notifications/initialized') {
      response.writeHead(202).end();
      return;
    }
    const result =
      body.method === 'initialize'
        ? {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'test-mcp', version: '1.0.0' },
          }
        : {
            tools: [
              {
                name: 'lookup',
                description: 'Lookup a record',
                inputSchema: { type: 'object', properties: {} },
              },
            ],
          };
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');

  try {
    const loaded = await connectMcpConnection({
      ...connection,
      id: 'fixture-mcp',
      url: `http://127.0.0.1:${address.port}/mcp`,
    });
    assert.deepEqual(Object.keys(loaded.tools), ['mcp_fixturemcp_lookup']);
    await loaded.close();
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('MCP proxy connection uses the proxy URL and proxy auth header', async () => {
  const requests: { url?: string; proxyAuth?: string }[] = [];
  const server = createServer(async (request, response) => {
    requests.push({
      url: request.url,
      proxyAuth: Array.isArray(request.headers['x-proxy-authorization'])
        ? request.headers['x-proxy-authorization'][0]
        : request.headers['x-proxy-authorization'],
    });
    const raw = await new Promise<string>((resolve, reject) => {
      let value = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => (value += chunk));
      request.on('end', () => resolve(value));
      request.on('error', reject);
    });
    if (!raw) {
      response.writeHead(204).end();
      return;
    }
    const body = JSON.parse(raw) as { id?: number; method: string };
    if (body.method === 'notifications/initialized') {
      response.writeHead(202).end();
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result:
          body.method === 'initialize'
            ? {
                protocolVersion: '2025-06-18',
                capabilities: { tools: {} },
                serverInfo: { name: 'test-proxy', version: '1.0.0' },
              }
            : { tools: [] },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');

  try {
    const loaded = await connectMcpConnection({
      ...proxyConnection,
      url: 'http://127.0.0.1:1/should-not-be-used',
      proxyUrl: `http://127.0.0.1:${address.port}/proxy-mcp`,
    });
    assert.deepEqual(loaded.tools, {});
    await loaded.close();
    assert(requests.some((request) => request.url === '/proxy-mcp'));
    assert(requests.every((request) => request.proxyAuth === 'proxy-private-token'));
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
