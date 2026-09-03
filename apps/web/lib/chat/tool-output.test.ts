import { describe, expect, it } from 'vitest';
import { decodeToolOutput } from './tool-output';

describe('decodeToolOutput', () => {
  it('unwraps a provider structured JSON output', () => {
    expect(
      decodeToolOutput({
        type: 'json',
        value: { chartType: 'bar', data: [{ label: 'A', value: 1 }] },
      }),
    ).toEqual({ chartType: 'bar', data: [{ label: 'A', value: 1 }] });
  });

  it('unwraps a JSON-encoded structured output', () => {
    expect(decodeToolOutput('{"type":"json","value":{"rows":[{"id":1}]}}')).toEqual({
      rows: [{ id: 1 }],
    });
  });

  it('leaves plain text output undecoded', () => {
    expect(decodeToolOutput('completed')).toBeUndefined();
  });
});
