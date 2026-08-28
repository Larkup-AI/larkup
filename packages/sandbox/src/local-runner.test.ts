import { describe, expect, it } from 'vitest';
import { executeLocally } from './local-runner.js';

describe('executeLocally', () => {
  it('runs JavaScript without Docker and returns output artifacts', async () => {
    const result = await executeLocally({
      language: 'javascript',
      code: `
        const fs = require('node:fs/promises');
        void (async () => {
          await fs.writeFile(process.env.LARKUP_OUTPUT_DIR + '/result.txt', 'done');
          console.log('local runtime');
        })();
      `,
    });

    expect(result).toMatchObject({ exitCode: 0, stdout: expect.stringContaining('local runtime') });
    expect(result.artifacts).toEqual([
      expect.objectContaining({ name: 'result.txt', mimeType: 'text/plain' }),
    ]);
  });
});
