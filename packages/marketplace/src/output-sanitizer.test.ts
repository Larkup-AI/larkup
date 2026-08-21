import { describe, expect, it } from 'vitest';
import { sanitizeGeneratedOutput } from './output-sanitizer';

describe('sanitizeGeneratedOutput', () => {
  it('removes hidden reasoning blocks and keeps final tool output', () => {
    expect(
      sanitizeGeneratedOutput(
        '<think>private chain of thought</think>\n## Overview\n[0:00–0:03] LARKUP VIDEO 2026.',
      ),
    ).toBe('## Overview\n[0:00–0:03] LARKUP VIDEO 2026.');
  });

  it('removes stray provider reasoning tags', () => {
    expect(sanitizeGeneratedOutput('<analysis>Visible evidence only</analysis>')).toBe('');
    expect(sanitizeGeneratedOutput('<reasoning>\nFinal notes')).toBe('Final notes');
  });
});
