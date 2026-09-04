import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getLarkupDataDir } from './project-store';

const originalDataDir = process.env.LARKUP_DATA_DIR;

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.LARKUP_DATA_DIR;
  else process.env.LARKUP_DATA_DIR = originalDataDir;
});

describe('getLarkupDataDir', () => {
  it('uses an explicit durable data directory when the packaged launcher provides one', () => {
    process.env.LARKUP_DATA_DIR = 'test-runtime-data';
    assert.equal(getLarkupDataDir(), path.resolve('test-runtime-data'));
  });

  it('keeps the local workspace default when no durable directory is configured', () => {
    delete process.env.LARKUP_DATA_DIR;
    assert.equal(getLarkupDataDir(), path.join(process.cwd(), '.larkup'));
  });
});
