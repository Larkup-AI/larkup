import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PY_SDK_DIR = path.resolve(__dirname, '../../../apps/sdk/py-sdk');
const PY_TEST_SCRIPT = path.resolve(__dirname, 'py_sdk_test.py');

const WEB_API = 'http://localhost:4567';
let RAG_SERVER = 'http://localhost:8080';

/**
 * Python SDK E2E tests — spawns a Python subprocess to test the SDK
 * against the running RAG server.
 */
test.describe('Python SDK — larkup', () => {
  test.beforeAll(async ({ request }) => {
    try {
      const statusRes = await request.get(`${WEB_API}/api/server/local`);
      const { state } = await statusRes.json();
      if (state.endpoint) {
        RAG_SERVER = state.endpoint;
      }
    } catch (e) {
      // fallback
    }

    // Check if Python is available
    try {
      execSync('python3 --version', { stdio: 'pipe' });
    } catch {
      console.warn('  ⚠ Python3 not found — Python SDK tests will be skipped');
    }

    // Check if uv is available and install dev deps
    try {
      execSync('uv --version', { stdio: 'pipe' });
      execSync('uv sync', { cwd: PY_SDK_DIR, stdio: 'pipe' });
    } catch {
      console.warn('  ⚠ uv not found — trying pip install');
      try {
        execSync('pip install -e .', { cwd: PY_SDK_DIR, stdio: 'pipe' });
      } catch {
        console.warn('  ⚠ Could not install py-sdk — tests may fail');
      }
    }
  });

  test('Python sync client — health, query, list_documents', async () => {
    test.setTimeout(60_000);

    try {
      const output = execSync(`python3 ${PY_TEST_SCRIPT} sync`, {
        cwd: PY_SDK_DIR,
        timeout: 50_000,
        encoding: 'utf-8',
        env: {
          ...process.env,
          LARKUP_API_URL: RAG_SERVER,
          PYTHONPATH: path.join(PY_SDK_DIR, 'src'),
        },
      });
      console.log(output);
      expect(output).toContain('PASS');
    } catch (err: any) {
      console.error('Python sync test failed:', err.stdout || err.stderr || err.message);
      throw err;
    }
  });

  test('Python async client — health, query', async () => {
    test.setTimeout(60_000);

    try {
      const output = execSync(`python3 ${PY_TEST_SCRIPT} async`, {
        cwd: PY_SDK_DIR,
        timeout: 50_000,
        encoding: 'utf-8',
        env: {
          ...process.env,
          LARKUP_API_URL: RAG_SERVER,
          PYTHONPATH: path.join(PY_SDK_DIR, 'src'),
        },
      });
      console.log(output);
      expect(output).toContain('PASS');
    } catch (err: any) {
      console.error('Python async test failed:', err.stdout || err.stderr || err.message);
      throw err;
    }
  });
});
