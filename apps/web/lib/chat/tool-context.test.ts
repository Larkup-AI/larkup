import { describe, expect, it } from 'vitest';
import {
  compactToolContextForModel,
  collectAnswerLevelMediaStatements,
  containsAnswerLevelMediaEvidence,
  collectQuestionMatchedDirectClaims,
  ensureNonEmptyTextStream,
  formatDirectObservationAnswer,
  formatExhaustiveMediaAnswer,
  formatOutcomeMediaAnswer,
  mediaClaimNeedsCorroboration,
  withFinalAnswerNudge,
} from './tool-context';

function toolResultMessage(toolName: string, output: unknown) {
  return {
    role: 'tool',
    content: [{ type: 'tool-result', toolName, output }],
  };
}

async function transformedChunks(chunks: any[], fallback = 'A visible fallback answer.') {
  const source = new ReadableStream<any>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });
  const reader = source.pipeThrough(ensureNonEmptyTextStream(fallback)()).getReader();
  const output: any[] = [];
  for (;;) {
    const next = await reader.read();
    if (next.done) return output;
    output.push(next.value);
  }
}

describe('ensureNonEmptyTextStream', () => {
  it.each(['finish', 'error', 'abort'])(
    'inserts visible text before a terminal %s',
    async (type) => {
      const chunks = await transformedChunks([
        { type: 'start-step' },
        { type: 'finish-step' },
        { type },
      ]);

      const terminalIndex = chunks.findIndex((chunk) => chunk.type === type);
      const fallbackIndex = chunks.findIndex(
        (chunk) => chunk.type === 'text-delta' && chunk.text === 'A visible fallback answer.',
      );
      expect(fallbackIndex).toBeGreaterThan(-1);
      expect(fallbackIndex).toBeLessThan(terminalIndex);
      expect(chunks.filter((chunk) => chunk.type === 'text-delta')).toHaveLength(1);
    },
  );

  it('also inserts visible text when a provider closes without a terminal chunk', async () => {
    const chunks = await transformedChunks([{ type: 'start-step' }, { type: 'finish-step' }]);
    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'text-delta', text: 'A visible fallback answer.' }),
      ]),
    );
    expect(chunks.findIndex((chunk) => chunk.type === 'text-delta')).toBeLessThan(
      chunks.findIndex((chunk) => chunk.type === 'finish-step'),
    );
  });

  it('does not add fallback text when the model already answered', async () => {
    const chunks = await transformedChunks([
      { type: 'start-step' },
      { type: 'text-delta', id: 'answer', text: 'The actual answer.' },
      { type: 'finish-step' },
      { type: 'finish' },
    ]);
    expect(chunks.filter((chunk) => chunk.type === 'text-delta')).toEqual([
      expect.objectContaining({ text: 'The actual answer.' }),
    ]);
  });
});

describe('collectAnswerLevelMediaStatements', () => {
  it('keeps a verified chronological trail available when the answer stream closes empty', () => {
    expect(
      collectAnswerLevelMediaStatements({
        videoEvidence: {
          success: true,
          claimVerification: { status: 'established-by-trail', directlyEstablished: false },
          evidence: [
            { payload: { text: 'Reconciled state: Alpha 2, Beta 3' } },
            { payload: { text: 'Reconciled state: Alpha 4, Beta 7' } },
          ],
        },
      }),
    ).toEqual(['Alpha 2, Beta 3', 'Alpha 4, Beta 7']);
  });

  it('does not turn an unverified locator into fallback answer text', () => {
    expect(
      collectAnswerLevelMediaStatements({
        success: true,
        claimVerification: { status: 'needs-corroboration' },
        evidence: [{ payload: { text: 'An unrelated nearby scene.' } }],
      }),
    ).toEqual([]);
  });
});

describe('formatOutcomeMediaAnswer', () => {
  it('answers from the latest verified state instead of dumping the whole trail', () => {
    const answer = formatOutcomeMediaAnswer(
      {
        videoEvidence: {
          success: true,
          claimVerification: { status: 'established-by-trail' },
          temporalContext: {
            readings: [
              { atSecs: 100, text: 'Reconciled state: Alpha=1200, Beta=900' },
              { atSecs: 590, text: 'Reconciled state: Final result: Alpha=1200, Beta=1400' },
            ],
          },
        },
      },
      'Who won the match?',
    );

    expect(answer).toBe('Beta won, 1400–1200 over Alpha.');
  });

  it('does not synthesize numeric states for a non-outcome question', () => {
    expect(
      formatOutcomeMediaAnswer(
        {
          success: true,
          claimVerification: { status: 'established-by-trail' },
          temporalContext: {
            readings: [{ atSecs: 10, text: 'Reconciled state: Alpha=1, Beta=2' }],
          },
        },
        'What were the participants wearing?',
      ),
    ).toBeUndefined();
  });
});

describe('formatDirectObservationAnswer', () => {
  it('returns the strongest verified bounded reading without another model pass', () => {
    expect(
      formatDirectObservationAnswer({
        videoEvidence: {
          success: true,
          claimVerification: { status: 'directly-established' },
          directObservation: {
            readings: [
              {
                found: 'A partial description.',
                confidence: 'medium',
                settlesQuestion: true,
              },
              {
                found: 'All four people are described separately and clearly.',
                confidence: 'high',
                settlesQuestion: true,
              },
            ],
          },
        },
      }),
    ).toBe('All four people are described separately and clearly.');
  });

  it('removes social-handle clutter from a positional group-appearance answer', () => {
    expect(
      formatDirectObservationAnswer(
        {
          success: true,
          claimVerification: { status: 'directly-established' },
          directObservation: {
            readings: [
              {
                found:
                  'From left to right: one wears green, one white-red, one gray, and one white. The first is identified as @unproven.',
                confidence: 'high',
                settlesQuestion: true,
              },
            ],
          },
        },
        'what was each person wearing?',
      ),
    ).toBe('From left to right: one wears green, one white-red, one gray, and one white.');
  });
});

describe('formatExhaustiveMediaAnswer', () => {
  it('returns every verified item chronologically without a model context limit', () => {
    const evidence = Array.from({ length: 320 }, (_, index) => ({
      timeRange: { startSecs: (319 - index) * 30, endSecs: (319 - index) * 30 + 10 },
      payload: { text: `Source question (spoken): Question ${319 - index}` },
    }));
    const answer = formatExhaustiveMediaAnswer(
      {
        videoEvidence: {
          success: true,
          claimVerification: { status: 'directly-established' },
          continuation: { exhaustive: true, hasMore: false },
          evidence,
        },
      },
      'list every question',
    );
    expect(answer?.match(/^- \[/gm)).toHaveLength(320);
    expect(answer).toContain('- [0:00] Question 0');
    expect(answer).toContain('- [2:39:30] Question 319');
    expect(answer?.indexOf('Question 0')).toBeLessThan(answer!.indexOf('Question 319'));
  });

  it('refuses to present an incomplete or unverified inventory as complete', () => {
    expect(
      formatExhaustiveMediaAnswer(
        {
          success: true,
          claimVerification: { status: 'needs-corroboration' },
          continuation: { exhaustive: true, hasMore: false },
          evidence: [{ payload: { text: 'Source item: one result' } }],
        },
        'list everything',
      ),
    ).toBeUndefined();
  });

  it('renders the compact verified Question records returned by the evidence tool', () => {
    const answer = formatExhaustiveMediaAnswer(
      {
        success: true,
        claimVerification: { status: 'directly-established' },
        continuation: { exhaustive: true, hasMore: false },
        evidence: [
          {
            timeRange: { startSecs: 12 },
            payload: { text: 'Question: Who scored?\nContext: Opening round' },
          },
          {
            timeRange: { startSecs: 42 },
            payload: { text: 'Question: Which team won?\nAnswer: Blue' },
          },
        ],
      },
      'list every question',
    );

    expect(answer).toBe(
      'Here is the complete list in chronological order:\n\n' +
        '- [0:12] Who scored?\n' +
        '- [0:42] Which team won?',
    );
  });

  it('leaves a small ordinary timeline for natural answer synthesis', () => {
    expect(
      formatExhaustiveMediaAnswer(
        {
          success: true,
          claimVerification: { status: 'directly-established' },
          continuation: { exhaustive: true, hasMore: false },
          evidence: [
            {
              timeRange: { startSecs: 10 },
              payload: { text: 'Reconciled state: Left 2, right 4' },
            },
          ],
        },
        'list the states',
      ),
    ).toBeUndefined();
  });
});

describe('compactToolContextForModel', () => {
  it('preserves the evidence-first videoEvidence field on a searchKnowledgeBase result', () => {
    // Regression: compaction only kept {query, hits}, silently dropping the
    // embedded video investigation the evidence-first shortcut relies on --
    // the model's next step then had nothing to answer a video question
    // from (observed live as a completely empty final chat response, even
    // though the video had been found correctly).
    const videoEvidence = { success: true, mediaAssetId: 'asset-1', citations: ['clip-1'] };
    const [message] = compactToolContextForModel([
      toolResultMessage('searchKnowledgeBase', {
        query: 'what crashed',
        hits: [{ documentId: 'd1', title: 't1', text: 'x'.repeat(2000) }],
        videoEvidence,
      }),
    ]);
    const output = (message.content[0] as any).output;
    expect(output.videoEvidence).toEqual(videoEvidence);
  });

  it('bounds a broad media investigation without discarding its temporal evidence', () => {
    const evidence = Array.from({ length: 60 }, (_, index) => ({
      id: `e-${index}`,
      modality: 'visual',
      timeRange: { startSecs: index * 60, endSecs: index * 60 + 20 },
      payload: 'x'.repeat(2_000),
      confidence: { score: 0.9 },
    }));
    const [message] = compactToolContextForModel([
      toolResultMessage('searchKnowledgeBase', {
        query: 'whole lecture',
        hits: [],
        videoEvidence: {
          success: true,
          mediaAssetId: 'asset-1',
          claimVerification: { directlyEstablished: true },
          investigation: { answerPath: 'rag', broadCoverage: true },
          evidence,
        },
      }),
    ]);

    const output = (message.content[0] as any).output.videoEvidence;
    expect(output.evidence).toHaveLength(48);
    expect(output.evidence[0].payload).toHaveLength(700);
    expect(output.claimVerification.directlyEstablished).toBe(true);
  });

  it('preserves bounded direct re-watch readings and temporal trajectory', () => {
    const [message] = compactToolContextForModel([
      toolResultMessage('queryVideoEvidence', {
        success: true,
        mediaAssetId: 'asset-1',
        evidence: [],
        directObservation: {
          rule: 'Answer from these readings.',
          readings: [
            {
              range: { startSecs: 10, endSecs: 20 },
              at: '0:10',
              found: 'The left person wears orange.',
              read: ['ORANGE'],
              confidence: 'high',
            },
          ],
        },
        temporalContext: {
          rule: 'Read the states as one trajectory.',
          readings: [{ atSecs: 10, text: 'Reconciled state: 2 and 3.' }],
        },
      }),
    ]);
    const output = (message.content[0] as any).output;
    expect(output.directObservation.readings[0].found).toContain('orange');
    expect(output.temporalContext.readings).toEqual([
      { atSecs: 10, text: 'Reconciled state: 2 and 3.' },
    ]);
  });

  it('keeps a larger bounded chronological account for an exhaustive video request', () => {
    const evidence = Array.from({ length: 120 }, (_, index) => ({
      id: `e-${index}`,
      modality: 'computed',
      timeRange: { startSecs: index * 30, endSecs: index * 30 + 10 },
      payload: `${index}: ${'detail '.repeat(100)}`,
    }));
    const [message] = compactToolContextForModel([
      toolResultMessage('searchKnowledgeBase', {
        query: 'list everything',
        hits: [],
        videoEvidence: {
          success: true,
          mediaAssetId: 'asset-1',
          continuation: { exhaustive: true, hasMore: false, totalItems: 120 },
          evidence,
        },
      }),
    ]);

    const output = (message.content[0] as any).output.videoEvidence;
    expect(output.evidence).toHaveLength(120);
    expect(output.evidence[0].payload).toHaveLength(260);
    expect(output.continuation).toMatchObject({ exhaustive: true, hasMore: false });
  });

  it('still bounds hits and truncates long text as before', () => {
    const manyHits = Array.from({ length: 10 }, (_, i) => ({
      documentId: `d${i}`,
      title: `t${i}`,
      text: 'x'.repeat(5_000),
    }));
    const [message] = compactToolContextForModel([
      toolResultMessage('searchKnowledgeBase', { query: 'q', hits: manyHits }),
    ]);
    const output = (message.content[0] as any).output;
    expect(output.hits).toHaveLength(4);
    expect(output.hits[0].text.length).toBe(1_200);
    expect(output.videoEvidence).toBeUndefined();
  });

  it('leaves messages without array content untouched', () => {
    const message = { role: 'user', content: 'plain text' };
    expect(compactToolContextForModel([message])).toEqual([message]);
  });

  it('still compacts queryTabularData results as before', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const [message] = compactToolContextForModel([
      toolResultMessage('queryTabularData', { columns: ['id'], rows, totalRows: 100 }),
    ]);
    const output = (message.content[0] as any).output;
    expect(output.rows).toHaveLength(50);
  });

  it('keeps bounded local PDF page evidence for the visual-analysis step', () => {
    const [message] = compactToolContextForModel([
      toolResultMessage('inspectPdfPages', {
        success: true,
        documentId: 'pdf-1',
        title: 'source.pdf',
        totalPages: 30,
        pages: Array.from({ length: 5 }, (_, index) => ({
          pageNumber: index + 1,
          text: 'x'.repeat(5_000),
          previewUrl: `/api/pdf-page?documentId=pdf-1&page=${index + 1}`,
        })),
      }),
    ]);
    const output = (message.content[0] as any).output;
    expect(output.documentId).toBe('pdf-1');
    expect(output.pages).toHaveLength(3);
    expect(output.pages[0].text).toHaveLength(1_600);
  });
});

describe('collectQuestionMatchedDirectClaims', () => {
  const evidence = {
    evidence: [
      {
        payload:
          'Claim question: who won the round\nClaim verdict: direct\nClaim answer: The second side won.',
      },
    ],
  };

  it('returns a direct claim for the same question', () => {
    expect(collectQuestionMatchedDirectClaims(evidence, 'which side won the round')).toEqual([
      'The second side won.',
    ]);
  });

  it('does not leak an old answer into a different follow-up', () => {
    expect(collectQuestionMatchedDirectClaims(evidence, 'what was each person wearing')).toEqual(
      [],
    );
  });
});

describe('withFinalAnswerNudge', () => {
  it('appends one explicit user message instructing the model to answer now', () => {
    // Regression: removing every tool for the final-answer step
    // (activeTools: [], toolChoice: 'none') wasn't reliable signal on its
    // own for every model -- reproduced live with a reasoning-tagged model
    // (Claude Sonnet 4.6) on a real, evidence-heavy video question: it
    // finished with zero tool calls AND zero text, leaving the chat turn
    // silently empty despite citations already having rendered from the
    // tool result. The explicit nudge fixed it, confirmed by re-running the
    // exact same live request afterward.
    const original = [{ role: 'user', content: 'original question' }];
    const nudged = withFinalAnswerNudge(original);

    expect(nudged).toHaveLength(2);
    expect(nudged[0]).toBe(original[0]);
    expect(nudged[1].role).toBe('user');
    expect(nudged[1].content[0].text).toMatch(/answer.*now/i);
  });

  it('does not mutate the input array', () => {
    const original = [{ role: 'user', content: 'q' }];
    withFinalAnswerNudge(original);
    expect(original).toHaveLength(1);
  });
});

describe('mediaClaimNeedsCorroboration', () => {
  it('accepts a conclusion established by a chronological evidence trail', () => {
    expect(
      mediaClaimNeedsCorroboration({
        status: 'established-by-trail',
        directlyEstablished: false,
      }),
    ).toBe(false);
  });

  it('keeps genuinely unresolved and legacy evidence behind the gate', () => {
    expect(
      mediaClaimNeedsCorroboration({
        status: 'needs-corroboration',
        directlyEstablished: false,
      }),
    ).toBe(true);
    expect(mediaClaimNeedsCorroboration({ directlyEstablished: false })).toBe(true);
  });
});

describe('containsAnswerLevelMediaEvidence', () => {
  it('accepts a chronological trail even though no single observation is direct', () => {
    expect(
      containsAnswerLevelMediaEvidence({
        videoEvidence: {
          success: true,
          claimVerification: {
            status: 'established-by-trail',
            directlyEstablished: false,
          },
          evidence: [{ payload: 'state one' }, { payload: 'state two' }],
        },
      }),
    ).toBe(true);
  });

  it('does not promote evidence that still requires corroboration', () => {
    expect(
      containsAnswerLevelMediaEvidence({
        success: true,
        claimVerification: { status: 'needs-corroboration' },
        evidence: [{ payload: 'candidate only' }],
      }),
    ).toBe(false);
  });
});
