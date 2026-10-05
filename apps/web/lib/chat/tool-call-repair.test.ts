import { describe, expect, it } from 'vitest';
import { repairChatToolCall, repairQueryTabularDataInput } from './tool-call-repair';

describe('repairQueryTabularDataInput', () => {
  it('moves misplaced limit and columns out of a long filters array', () => {
    const ids = Array.from({ length: 40 }, (_, index) => `guest-${index + 1}`);
    const repaired = repairQueryTabularDataInput({
      datasetId: 'guests',
      filters: [
        { column: 'guest_id', op: 'in', value: ids },
        "limit':37,",
        'columns:[',
        'guest_id',
        'name',
        'Knowledge & Expertise',
      ],
    });

    expect(repaired).toEqual({
      datasetId: 'guests',
      filters: [{ column: 'guest_id', op: 'in', value: ids }],
      limit: 37,
      columns: ['guest_id', 'name', 'Knowledge & Expertise'],
    });
  });

  it('does not guess how to repair an unknown invalid filter', () => {
    expect(
      repairQueryTabularDataInput({
        datasetId: 'guests',
        filters: [{ column: 'active', op: 'eq', value: true }, 'discard this'],
      }),
    ).toBeNull();
  });
});

describe('repairChatToolCall', () => {
  it('returns a schema-ready replacement tool call', async () => {
    const original = {
      type: 'tool-call' as const,
      toolCallId: 'call-1',
      toolName: 'queryTabularData',
      input: JSON.stringify({
        datasetId: 'guests',
        filters: [
          { column: 'guest_id', op: 'in', value: ['guest-1', 'guest-2'] },
          "limit':2,",
          'columns:[',
          'guest_id',
          'name',
        ],
      }),
    };

    const repaired = await repairChatToolCall({ toolCall: original } as any);
    expect(repaired).not.toBeNull();
    expect(JSON.parse(repaired!.input)).toEqual({
      datasetId: 'guests',
      filters: [{ column: 'guest_id', op: 'in', value: ['guest-1', 'guest-2'] }],
      limit: 2,
      columns: ['guest_id', 'name'],
    });
  });
});
