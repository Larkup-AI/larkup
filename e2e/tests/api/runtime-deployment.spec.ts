import { test, expect } from '@playwright/test';
import {
  applyDeploymentStorageSettings,
  deploymentStatusFromVercelReadyState,
  VERCEL_DEPLOYMENT_API_URL,
  vercelDeploymentStatusUrl,
} from '../../../apps/web/lib/deployments';
import { DEFAULT_CONFIG } from '../../../packages/core/src/types';

test('confirms automatic framework detection for newly created Vercel projects', () => {
  const endpoint = new URL(VERCEL_DEPLOYMENT_API_URL);

  expect(endpoint.pathname).toBe('/v13/deployments');
  expect(endpoint.searchParams.get('skipAutoDetectionConfirmation')).toBe('1');
});

test('maps Vercel lifecycle states to visible deployment statuses', () => {
  expect(deploymentStatusFromVercelReadyState('QUEUED')).toBe('queued');
  expect(deploymentStatusFromVercelReadyState('BUILDING')).toBe('building');
  expect(deploymentStatusFromVercelReadyState('READY')).toBe('ready');
  expect(deploymentStatusFromVercelReadyState('ERROR')).toBe('error');
  expect(deploymentStatusFromVercelReadyState('CANCELED')).toBe('canceled');
  expect(vercelDeploymentStatusUrl('dpl_123')).toBe('https://api.vercel.com/v13/deployments/dpl_123');
});

test('uses and retains the vector-store selection supplied at deployment time', () => {
  const storage = {
    vectorStore: 'lancedb' as const,
    storeConfig: {
      mode: 's3',
      s3Uri: 's3://knowledge/larkup/project',
      s3Region: 'auto',
      s3AccessKeyId: 'key',
      s3SecretAccessKey: 'secret',
    },
    embeddingModelId: 'openai/text-embedding-3-large',
  };
  const configured = applyDeploymentStorageSettings(DEFAULT_CONFIG, storage);

  expect(configured.vectorStore).toBe('lancedb');
  expect(configured.storeConfig).toEqual(storage.storeConfig);
  expect(configured.embeddingModelId).toBe('openai/text-embedding-3-large');
  expect(configured.projectName).toBe(DEFAULT_CONFIG.projectName);
});

test('uses an AI chat provider override only for the generated deployment runtime', () => {
  const configured = applyDeploymentStorageSettings(DEFAULT_CONFIG, {
    chatProvider: 'deepseek',
    chatModelId: 'deepseek/deepseek-chat',
    chatApiKey: 'deployment-only-key',
  });

  expect(configured.chatProvider).toBe('deepseek');
  expect(configured.chatModelId).toBe('deepseek/deepseek-chat');
  expect(configured.chatApiKey).toBe('deployment-only-key');
  expect(DEFAULT_CONFIG.chatProvider).not.toBe('deepseek');
});

test('rejects a serverless Agent deployment when enabled tools need a local sandbox', async ({
  request,
}) => {
  const response = await request.post('/api/projects/deployments', {
    data: {
      provider: 'Vercel',
      profile: 'assistant',
      assistantOptions: {
        enabledTools: ['executeAnalysis'],
        sandboxProvider: 'local',
      },
      deployConfig: { credentials: { vercelToken: 'not-used', vercelProject: 'not-used' } },
    },
  });

  expect(response.status()).toBe(422);
  expect((await response.json()).error).toMatch(/serverless.*local sandbox/i);
});
