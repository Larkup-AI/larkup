import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { DEFAULT_CONFIG } from '@larkup/core/types';
import { runWithWorkspaceHost, type WorkspaceHost } from '@larkup/core/workspace-host';
import type { ExecutionRequest, ExecutionResult } from '@larkup/sandbox/types';
import { getChatTools } from '../src/app/api/chat/tools.ts';
import { runWithWorkspaceRuntime } from '../src/runtime-host.ts';

const executeFile = promisify(execFile);

test('failed model matching code is replaced by a complete balanced artifact', async () => {
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
  const rows = needs.map((need, index) => ({
    Name: `Person ${index + 1}`,
    'Current Needs': need,
    'What can you offer?': offers[index],
  }));
  const datasetId = crypto.randomUUID();
  const longDatasetId = crypto.randomUUID();
  const longNeedsColumn =
    'Question 2: Current Needs: "What would you benefit from most right now?"';
  const longOffersColumn =
    "Question 3: \"Anything else you'd like to add? Share what you're bringing to the table or what you're looking for.\"";
  const longColumns = ['Name', 'Email', longNeedsColumn, longOffersColumn];
  const longRows = Array.from({ length: 102 }, (_, index) => ({
    Name: `Participant ${index + 1}`,
    Email: `participant${index + 1}@example.com`,
    [longNeedsColumn]: `Introductions to group ${index % 6} and support with topic ${index % 11}`,
    [longOffersColumn]: `Expertise in group ${(index + 1) % 6} and topic ${(index + 3) % 11}`,
  }));
  const now = new Date().toISOString();
  const config = { ...DEFAULT_CONFIG, defaultSandboxProvider: 'local' as const };
  const host: WorkspaceHost = {
    project: { id: crypto.randomUUID(), name: 'Test', port: 0, createdAt: now, updatedAt: now },
    readConfig: async () => config,
    writeConfig: async (value) => value,
    readState: async () => undefined,
    writeState: async () => {},
    readDocuments: async () => [],
    writeDocuments: async () => {},
    readGroups: async () => [],
    writeGroups: async () => {},
    readMediaAssets: async () => [],
    writeMediaAssets: async () => {},
    readTabularDatasets: async () => [
      {
        id: datasetId,
        fileName: 'adversarial-matching.csv',
        columns: columns.map((name) => ({
          name,
          type: 'string' as const,
          nullCount: 0,
          uniqueCount: rows.length,
        })),
        rows,
        summary: {
          totalRows: rows.length,
          totalColumns: columns.length,
          numericColumns: 0,
          categoricalColumns: columns.length,
          dateColumns: 0,
        },
        rowCount: rows.length,
        createdAt: now,
      },
      {
        id: longDatasetId,
        fileName: 'participants-102.xlsx',
        columns: longColumns.map((name) => ({
          name,
          type: 'string' as const,
          nullCount: 0,
          uniqueCount: longRows.length,
        })),
        rows: longRows,
        summary: {
          totalRows: longRows.length,
          totalColumns: longColumns.length,
          numericColumns: 0,
          categoricalColumns: longColumns.length,
          dateColumns: 0,
        },
        rowCount: longRows.length,
        createdAt: now,
      },
    ],
    writeTabularDatasets: async () => {},
    queryKnowledge: async () => [],
    trackUsage: async (event) => ({ ...event, id: crypto.randomUUID() }),
    tools: [],
  };
  let executions = 0;
  const execute = async (request: ExecutionRequest): Promise<ExecutionResult> => {
    executions += 1;
    const directory = await mkdtemp(join(tmpdir(), 'larkup-tool-fallback-'));
    for (const file of request.files ?? []) {
      await writeFile(
        join(directory, file.name),
        file.isBase64 ? Buffer.from(file.content, 'base64') : file.content,
      );
    }
    const startedAt = Date.now();
    try {
      const result = await executeFile('python3', ['-c', request.code], {
        cwd: directory,
        encoding: 'utf8',
        maxBuffer: 5_000_000,
      });
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: 0,
        artifacts: [],
        executionTimeMs: Date.now() - startedAt,
      };
    } catch (error) {
      const failure = error as Error & { stdout?: string; stderr?: string; code?: number };
      return {
        stdout: failure.stdout ?? '',
        stderr: failure.stderr ?? failure.message,
        exitCode: typeof failure.code === 'number' ? failure.code : 1,
        artifacts: [],
        executionTimeMs: Date.now() - startedAt,
      };
    }
  };

  await runWithWorkspaceHost(host, () =>
    runWithWorkspaceRuntime(
      {
        sandbox: {
          healthCheck: async () => ({ backend: 'local', status: 'ready' }),
          execute,
        },
      },
      async () => {
        const requestText =
          'For the first 8 people from the list, make 3 matches. Every person can be suggested not more than 3 times.';
        const { tools } = await getChatTools({ config, requestText });
        const analysis = tools.executeAnalysis as {
          execute?: (input: unknown, options: unknown) => Promise<unknown>;
        };
        assert.ok(analysis.execute);
        const output = (await analysis.execute(
          { code: 'raise RuntimeError("model-authored matching failed")', datasetId },
          {},
        )) as {
          exitCode: number;
          presentation?: {
            kind?: string;
            rows?: unknown[];
            totalItems?: number;
            requestedItems?: number;
            complete?: boolean;
          };
        };
        assert.equal(executions, 3);
        assert.equal(output.exitCode, 0);
        assert.equal(output.presentation?.kind, 'table');
        assert.equal(output.presentation?.rows?.length, 24);
        assert.equal(output.presentation?.totalItems, 24);
        assert.equal(output.presentation?.requestedItems, 8);
        assert.equal(output.presentation?.complete, true);

        const longRequestText = `You have a data document listing 102 participants. For each person from the list, make 3 matches with other people from the list based on people's needs and offers - Question 2: Current Needs: "What would you benefit from most right now?" Question 3: "Anything else you'd like to add? Share what you're bringing to the table or what you're looking for." Each person should be matched with no more than 6 people in total: 3 times they might be a good match for someone, and 3 times they should be matched with someone. For every match, write a one-sentence explanation of why this is the best choice and mention their email. Other information is not important.`;
        const longTools = await getChatTools({ config, requestText: longRequestText });
        const longAnalysis = longTools.tools.executeAnalysis as {
          execute?: (input: unknown, options: unknown) => Promise<unknown>;
        };
        assert.ok(longAnalysis.execute);
        const longOutput = (await longAnalysis.execute(
          {
            code: 'raise RuntimeError("model-authored matching failed")',
            datasetId: longDatasetId,
          },
          {},
        )) as {
          exitCode: number;
          presentation?: {
            kind?: string;
            columns?: string[];
            rows?: Array<Record<string, unknown>>;
            totalItems?: number;
            requestedItems?: number;
            complete?: boolean;
          };
        };
        assert.equal(executions, 6);
        assert.equal(longOutput.exitCode, 0);
        assert.equal(longOutput.presentation?.kind, 'table');
        assert.equal(longOutput.presentation?.rows?.length, 306);
        assert.equal(longOutput.presentation?.totalItems, 306);
        assert.equal(longOutput.presentation?.requestedItems, 102);
        assert.equal(longOutput.presentation?.complete, true);
        assert.deepEqual(longOutput.presentation?.columns, [
          'Participant',
          'Match',
          'Email',
          'Rank',
          'Reason',
        ]);
        const longResultRows = longOutput.presentation?.rows ?? [];
        const targetCounts = new Map<string, number>();
        const suggestionCounts = new Map<string, number>();
        for (const row of longResultRows) {
          const target = String(row.Participant ?? '');
          const suggestion = String(row.Match ?? '');
          targetCounts.set(target, (targetCounts.get(target) ?? 0) + 1);
          suggestionCounts.set(suggestion, (suggestionCounts.get(suggestion) ?? 0) + 1);
          assert.match(String(row.Email ?? ''), /^participant\d+@example\.com$/);
          assert.match(String(row.Reason ?? ''), /\.$/);
        }
        assert.equal(targetCounts.size, 102);
        assert.ok([...targetCounts.values()].every((count) => count === 3));
        assert.ok([...suggestionCounts.values()].every((count) => count <= 3));
      },
    ),
  );
});
