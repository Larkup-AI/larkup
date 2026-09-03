import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { AGENT_TOOLS, attachVideoIntelligenceAgentClient } from './agent';
import { VideoIntelligenceClient } from './client';

type Hit = {
  evidence: {
    id: string;
    modality: string;
    timeRange: { startSecs: number; endSecs: number };
    payload: unknown;
    confidence: { score: number };
    createdAt: string;
    source?: { kind: string; provider: string };
  };
  components?: { semantic?: number; lexical?: number };
};

const INDEXED_AT = '2026-01-01T00:00:00.000Z';

function hit(
  id: string,
  startSecs: number,
  payload: unknown,
  overrides: Partial<Hit['evidence']> = {},
): Hit {
  return {
    evidence: {
      id,
      modality: 'visual',
      timeRange: { startSecs, endSecs: startSecs + 10 },
      payload,
      confidence: { score: 0.9 },
      createdAt: INDEXED_AT,
      ...overrides,
    },
  };
}

function directVerdict(id: string, startSecs: number, question: string, answer: string): Hit {
  return hit(
    id,
    startSecs,
    `Claim question: ${question}\nClaim verdict: direct\nClaim answer: ${answer}`,
  );
}

function agentClient(fetcher: any) {
  return attachVideoIntelligenceAgentClient(
    new VideoIntelligenceClient({ mode: 'local-docker', fetch: fetcher }),
    fetcher,
  );
}

function evidenceContext(overrides: {
  plan: Record<string, unknown>;
  search: (
    query: string,
    options?: Record<string, unknown>,
    limit?: number,
  ) => Promise<Hit[]> | Hit[];
  durationSecs?: number;
  fileName?: string;
  planInvestigation?: () => Promise<unknown>;
  reWatch?: (...args: any[]) => Promise<unknown>;
}) {
  return {
    origin: 'https://larkup.example.test',
    mediaEvidence: {
      getAsset: async () => ({
        id: 'media-1',
        type: 'video',
        processingStatus: 'completed',
        durationSecs: overrides.durationSecs ?? 120,
        fileName: overrides.fileName,
      }),
      planQuestion: () => overrides.plan,
      ...(overrides.planInvestigation ? { planInvestigation: overrides.planInvestigation } : {}),
      ...(overrides.reWatch ? { reWatch: overrides.reWatch } : {}),
      search: async (
        _id: string,
        query: string,
        _limit: number,
        options?: Record<string, unknown>,
      ) => overrides.search(query, options, _limit),
    },
  } as any;
}

describe('Video Intelligence chat extension', () => {
  it('declares a generic evidence query plus bounded refinement action', () => {
    expect(AGENT_TOOLS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'queryVideoEvidence',
          method: 'queryVideoEvidence',
          workflow: 'evidence-query',
        }),
        expect.objectContaining({
          name: 'inspectVideoKnowledge',
          method: 'inspectVideoKnowledge',
          workflow: 'evidence-refinement',
        }),
      ]),
    );
    const queryTool = AGENT_TOOLS.find((item) => item.name === 'queryVideoEvidence');
    expect(queryTool?.description).toMatch(/RAG index first/i);
    expect(queryTool?.systemPromptFragment).toContain('only watches a bounded source moment');
    expect(queryTool?.systemPromptFragment).toContain('not phrases such as "the video shows"');
  });

  it('re-watches the source before dispatching a re-index, and answers from what it read', async () => {
    const fetcher = vi.fn(async () => Response.json({ evidence: [], status: 'completed' })) as any;
    const reWatch = vi.fn(async () => [
      {
        range: { startSecs: 90, endSecs: 120 },
        at: '1:30–2:00',
        found: 'The displayed total changes from 3 to 4 and stays there.',
        settlesQuestion: true,
        read: ['TOTAL 4'],
        confidence: 'high' as const,
      },
    ]);

    const result: any = await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'What was the final total?' },
      evidenceContext({
        plan: {
          kinds: ['outcome'],
          requiresInspectionWhenInsufficient: true,
        },
        // Nothing indexed settles this, which is exactly when the source
        // itself should be read rather than a re-index dispatched.
        search: () => [hit('stale', 10, 'An early unrelated moment.')],
        reWatch,
      }),
    );

    expect(reWatch).toHaveBeenCalledTimes(1);
    // The dispatched path costs minutes on a cold worker; it must not run once
    // the source has already answered the question.
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.investigation.answerPath).toBe('rag+rewatch');
    expect(result.claimVerification.directlyEstablished).toBe(true);
    expect(result.directObservation.readings[0].found).toMatch(/changes from 3 to 4/);
    expect(result.directObservation.rule).toMatch(/do not\s+report that the source fails to show/);
    // A reader can misread a frame and state it confidently. The reply must
    // weigh the readings against each other rather than repeating each one.
    expect(result.directObservation.rule).toMatch(
      /is a misreading, whatever confidence it carries/,
    );
  });

  it('re-watches multiple closing-phase windows for a long-source outcome', async () => {
    const reWatch = vi.fn(async () => [
      {
        range: { startSecs: 2_839.5, endSecs: 2_899.5 },
        at: '47:19–48:19',
        found: 'The ending state is visible here.',
        settlesQuestion: true,
        read: [],
        confidence: 'high' as const,
      },
    ]);
    await agentClient(vi.fn() as any).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'Who won?' },
      evidenceContext({
        durationSecs: 3_052.1,
        plan: { kinds: ['outcome'], requiresInspectionWhenInsufficient: true },
        search: () => [hit('opening', 20, 'An unrelated opening detail.')],
        reWatch,
      }),
    );

    const ranges = reWatch.mock.calls[0][2] as Array<{ startSecs: number; endSecs: number }>;
    expect(ranges.some((range) => Math.abs(range.startSecs - 2_839.495) < 0.01)).toBe(true);
    expect(ranges.some((range) => Math.abs(range.startSecs - 2_992.1) < 0.01)).toBe(true);
  });

  it('falls back to the dispatched inspection when the source cannot be re-watched', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ evidence: [{ id: 'fresh' }], status: 'completed' }),
    ) as any;

    await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'What was the final total?' },
      evidenceContext({
        plan: { kinds: ['outcome'], requiresInspectionWhenInsufficient: true },
        search: () => [hit('stale', 10, 'An early unrelated moment.')],
        // A host without source access or a vision capability omits reWatch,
        // and the tool has to keep working without it.
        reWatch: undefined,
      }),
    );

    expect(fetcher).toHaveBeenCalled();
  });

  it('still dispatches when a re-watch finds related detail but does not settle the question', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ evidence: [{ id: 'fresh' }], status: 'completed' }),
    ) as any;
    const reWatch = vi.fn(async () => [
      {
        range: { startSecs: 90, endSecs: 120 },
        at: '1:30–2:00',
        found: 'A scoreboard is visible, but the final total is not readable.',
        settlesQuestion: false,
        read: [],
        confidence: 'low' as const,
      },
    ]);

    await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'What was the final total?' },
      evidenceContext({
        plan: { kinds: ['outcome'], requiresInspectionWhenInsufficient: true },
        search: () => [hit('stale', 10, 'An early unrelated moment.')],
        reWatch,
      }),
    );

    expect(reWatch).toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalled();
  });

  it('owns a bounded host inspection request and carries project and progress context', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ evidence: [{ id: 'fresh-evidence' }], status: 'completed' }),
    ) as any;
    const client = agentClient(fetcher);

    const result = await client.inspectVideoKnowledge(
      {
        mediaAssetId: 'media-1',
        startSecs: 0,
        endSecs: 120,
        purpose: 'verify-visual',
        queryId: 'question-1',
      },
      { origin: 'https://larkup.example.test', projectId: 'project-1', toolCallId: 'call-1' },
    );

    expect(result).toMatchObject({ success: true, evidence: [{ id: 'fresh-evidence' }] });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toBe(
      'https://larkup.example.test/api/media/inspect?projectId=project-1',
    );
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      startSecs: 60,
      endSecs: 120,
      toolCallId: 'call-1',
    });
  });

  it('forwards the tool-selected verification level without host-specific routing', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ evidence: [{ id: 'fresh-evidence' }] }),
    ) as any;
    await agentClient(fetcher).inspectVideoKnowledge(
      {
        mediaAssetId: 'media-1',
        startSecs: 2,
        endSecs: 10,
        purpose: 'verify-visual',
        queryId: 'q',
        analysisMode: 'thorough',
      },
      { origin: 'https://larkup.example.test' },
    );
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ analysisMode: 'thorough' });
  });

  it('ends a stalled inspection at the caller deadline instead of leaving chat loading', async () => {
    const fetcher = vi.fn(
      (_url: URL, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
            once: true,
          });
        }),
    ) as any;

    const result = await agentClient(fetcher).inspectVideoKnowledge(
      {
        mediaAssetId: 'media-1',
        startSecs: 0,
        endSecs: 10,
        purpose: 'verify-visual',
        queryId: 'stalled-inspection',
        maxWaitMs: 10,
      },
      { origin: 'https://larkup.example.test' },
    );

    expect(result).toMatchObject({
      success: false,
      error: 'Video analysis did not finish within the interactive response budget.',
    });
  });

  it('answers from the index alone when it already establishes the claim', async () => {
    const fetcher = vi.fn() as any;
    const question = 'What did the presenter say about pricing?';
    const result = await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: question },
      evidenceContext({
        plan: { kinds: ['direct-speech'], requiresInspectionWhenInsufficient: false },
        search: () => [
          hit('spoken', 40, 'The presenter states the pricing tiers.', { modality: 'transcript' }),
        ],
      }),
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      claimVerification: { directlyEstablished: true },
      investigation: { answerPath: 'rag' },
    });
  });

  it('does not run hierarchy or visual locating before accepting a complete indexed answer', async () => {
    const fetcher = vi.fn() as any;
    const locate = vi.fn(async () => []);
    const planInvestigation = vi.fn(async () => ({ candidateRanges: [] }));
    const context = evidenceContext({
      plan: { kinds: ['direct-speech'], requiresInspectionWhenInsufficient: false },
      search: () => [
        {
          ...hit('spoken-fast', 40, 'The presenter gives the requested answer.', {
            modality: 'transcript',
          }),
          components: { semantic: 0.9 },
        },
      ],
      planInvestigation,
    });
    (context.mediaEvidence as any).locate = locate;

    const result: any = await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'What did the presenter answer?' },
      context,
    );

    expect(result.investigation.answerPath).toBe('rag');
    expect(planInvestigation).not.toHaveBeenCalled();
    expect(locate).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reads a located evidence range before broad RAG can omit the direct observation', async () => {
    const fetcher = vi.fn() as any;
    const question = 'Which team won the match?';
    const rangedSearches: Array<Record<string, unknown> | undefined> = [];

    const result = await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: question },
      {
        ...evidenceContext({
          durationSecs: 3_000,
          plan: { kinds: ['outcome'], requiresInspectionWhenInsufficient: true },
          search: (_query, options) => {
            if (options?.timeRange) {
              rangedSearches.push(options);
              return [directVerdict('located-direct', 2_850, question, 'Blue team')];
            }
            return [
              hit('broad-overview', 0, 'A broad recap without the final result.', {
                modality: 'computed',
              }),
            ];
          },
        }),
        mediaEvidence: {
          ...evidenceContext({
            durationSecs: 3_000,
            plan: { kinds: ['outcome'], requiresInspectionWhenInsufficient: true },
            search: (_query, options) => {
              if (options?.timeRange) {
                rangedSearches.push(options);
                return [directVerdict('located-direct', 2_850, question, 'Blue team')];
              }
              return [
                hit('broad-overview', 0, 'A broad recap without the final result.', {
                  modality: 'computed',
                }),
              ];
            },
          }).mediaEvidence,
          locate: async () => [
            { startSecs: 2_840, endSecs: 2_900, score: 1, sources: ['semantic'] },
          ],
        },
      } as any,
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(rangedSearches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          timeRange: expect.objectContaining({ startSecs: 2_840, endSecs: 2_900 }),
        }),
      ]),
    );
    expect(result).toMatchObject({
      claimVerification: { directlyEstablished: true },
      investigation: { answerPath: 'rag' },
    });
    expect((result as any).evidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'located-direct' })]),
    );
  });

  it('watches the source when the index cannot settle the claim, then answers from what it saw', async () => {
    let inspected = false;
    const fetcher = vi.fn(async () => {
      inspected = true;
      return Response.json({ evidence: [{ id: 'fresh-evidence' }] });
    }) as any;
    const question = 'What is the final state?';

    const result = await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: question },
      evidenceContext({
        plan: { kinds: ['outcome'], requiresInspectionWhenInsufficient: true },
        search: () =>
          inspected
            ? [directVerdict('direct', 60, question, 'resolved')]
            : [hit('nearby', 60, 'Current value: 70', { modality: 'ocr' })],
      }),
    );

    expect(fetcher).toHaveBeenCalled();
    expect(result).toMatchObject({
      claimVerification: { directlyEstablished: true },
      investigation: { answerPath: 'rag+analysis' },
      evidence: [{ id: 'direct' }],
    });
  });

  it('reads freshly watched evidence by timestamp before broad RAG can rank it away', async () => {
    let inspected = false;
    const fetcher = vi.fn(async () => {
      inspected = true;
      return Response.json({ evidence: [{ id: 'fresh-evidence' }] });
    }) as any;
    const question = 'Which team won the match?';
    const rangeSearches: Array<Record<string, unknown> | undefined> = [];

    const result = (await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: question },
      evidenceContext({
        durationSecs: 3_000,
        plan: { kinds: ['outcome'], requiresInspectionWhenInsufficient: true },
        search: (_query, options) => {
          if (options?.timeRange) {
            rangeSearches.push(options);
            return [
              hit(
                `fresh-account-${(options.timeRange as any).startSecs}`,
                (options.timeRange as any).startSecs + 1,
                'The closing display shows the blue side ahead.',
                { createdAt: new Date().toISOString() },
              ),
            ];
          }
          return inspected
            ? [hit('old-overview', 100, 'An overview of the opening round.')]
            : [hit('candidate', 2_850, 'The score is visible near the end.', { modality: 'ocr' })];
        },
      }),
    )) as any;

    expect(rangeSearches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ timeRange: { startSecs: 2_640, endSecs: 2_700 } }),
      ]),
    );
    expect(result).toMatchObject({
      claimVerification: { directlyEstablished: true },
      investigation: { answerPath: 'rag+analysis' },
    });
    expect(result.evidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'fresh-account-2640' })]),
    );
  });

  it('does not report a claim as established when nothing in the source settles it', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ evidence: [{ id: 'fresh-evidence' }] }),
    ) as any;
    const question = 'What is the final state?';

    const result = (await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: question },
      evidenceContext({
        plan: { kinds: ['outcome'], requiresInspectionWhenInsufficient: true },
        // Analysis ran but produced nothing that answers the question.
        search: () => [hit('unrelated', 20, 'A caption unrelated to the question.')],
      }),
    )) as any;

    expect(fetcher).toHaveBeenCalled();
    expect(result.claimVerification.directlyEstablished).toBe(false);
    expect(result.claimVerification.rule).toMatch(/did not show/i);
    expect(result.ui).toBeUndefined();
  });

  // The defect this covers: a conclusion is settled by reading a trail of
  // states, not by finding one record that announces it. Requiring a single
  // record made every such question come back as "could not be confirmed" even
  // when the closing state was plainly indexed.
  it('answers a conclusion from a trail of indexed states rather than declining', async () => {
    const fetcher = vi.fn(async () => Response.json({ evidence: [] })) as any;
    const question = 'which side finished ahead';

    const result = (await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: question },
      evidenceContext({
        plan: { kinds: ['outcome'], requiresInspectionWhenInsufficient: true },
        durationSecs: 3_000,
        search: () => [
          hit(
            'late',
            2_800,
            'Reconciled state: the right side reads 3800 and the left side reads 3000.',
            {
              modality: 'computed',
              source: { kind: 'provider', provider: 'video-intelligence-index' },
            },
          ),
          hit(
            'mid',
            2_400,
            'Reconciled state: the right side reads 3800 while the left side reads 2700.',
            {
              modality: 'computed',
              source: { kind: 'provider', provider: 'video-intelligence-index' },
            },
          ),
          hit('early', 600, 'Reconciled state: both sides read 200 as the round begins.', {
            modality: 'computed',
            source: { kind: 'provider', provider: 'video-intelligence-index' },
          }),
        ],
      }),
    )) as any;

    expect(result.claimVerification.directlyEstablished).toBe(false);
    expect(result.claimVerification.status).toBe('established-by-trail');
    expect(result.claimVerification.rule).toMatch(/read (?:across|together)/i);
    expect(result.claimVerification.rule).not.toMatch(/did not show/i);
    // A trail shuffled by relevance cannot be read as one.
    expect(result.evidence.map((item: any) => item.id)).toEqual(['early', 'mid', 'late']);
  });

  it('answers a multilingual winner question from the indexed closing trail', async () => {
    const fetcher = vi.fn() as any;
    const title = 'احمد عز و احمد عطا | فى السبعين مع سين جيم';
    const question = `who won ${title}`;
    const closingTrail = [
      hit('participant-zizo', 30, 'Reconciled participant: Zizo — contestant', {
        modality: 'computed',
        source: { kind: 'provider', provider: 'video-intelligence-index' },
      }),
      hit('closing-speech', 2_953, 'مبروك يا زيزو، أنت كسبت المباراة.', {
        modality: 'transcript',
      }),
      hit(
        'closing-index',
        2_953,
        'Reconciled event: Zizo is congratulated for winning the match.',
        {
          modality: 'computed',
          source: { kind: 'provider', provider: 'video-intelligence-index' },
        },
      ),
    ];

    const result = (await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: question },
      evidenceContext({
        fileName: title,
        durationSecs: 3_000,
        plan: {
          kinds: ['outcome'],
          requiresIdentityContext: true,
          requiresInspectionWhenInsufficient: true,
        },
        search: () => closingTrail,
      }),
    )) as any;

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.claimVerification.status).toBe('established-by-trail');
    expect(result.claimVerification.rule).not.toMatch(/did not show|could not confirm/i);
    expect(result.evidence.map((item: any) => String(item.payload)).join('\n')).toContain(
      'Zizo is congratulated for winning the match.',
    );
  });

  it('does not treat semantic similarity as proof of an unresolved identity', async () => {
    const fetcher = vi.fn() as any;
    const reWatch = vi.fn(async () => [
      {
        range: { startSecs: 2_940, endSecs: 3_000 },
        at: '49:00–50:00',
        found: 'Omar is explicitly announced as the person who finished ahead.',
        settlesQuestion: true,
        read: [],
        confidence: 'high' as const,
      },
    ]);
    const title = 'محمد حازم و عمر خالد | فى السبعين مع سين جيم';
    const indexedResolution = {
      ...hit(
        'closing-resolution',
        2_950,
        'Reconciled event: Omar is congratulated after the result is settled.',
        {
          modality: 'computed',
          source: { kind: 'provider', provider: 'video-intelligence-index' },
        },
      ),
      components: { semantic: 0.86, lexical: 0 },
    };

    const result: any = await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: `who won ${title}` },
      evidenceContext({
        fileName: title,
        durationSecs: 3_000,
        plan: {
          kinds: ['outcome'],
          requiresIdentityContext: true,
          requiresInspectionWhenInsufficient: true,
        },
        search: () => [indexedResolution],
        reWatch,
      }),
    );

    expect(result.investigation.answerPath).toBe('rag+rewatch');
    expect(result.claimVerification.directlyEstablished).toBe(true);
    expect(result.directObservation.readings[0].found).toMatch(/Omar is explicitly announced/);
    expect(reWatch).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('falls back when indexed result states do not identify which named person they belong to', async () => {
    const fetcher = vi.fn() as any;
    const reWatch = vi.fn(async () => [
      {
        range: { startSecs: 2_940, endSecs: 3_000 },
        at: '49:00–50:00',
        found: 'The closing announcement names Mohamed as the person who finished ahead.',
        settlesQuestion: true,
        read: [],
        confidence: 'high' as const,
      },
    ]);
    const reconciled = (id: string, at: number, text: string) =>
      hit(id, at, `Reconciled state: ${text}`, {
        modality: 'computed',
        source: { kind: 'provider', provider: 'video-intelligence-index' },
      });

    const result: any = await agentClient(fetcher).queryVideoEvidence(
      {
        mediaAssetId: 'media-1',
        query: 'who won محمد حازم و عمر خالد | فى السبعين مع سين جيم',
      },
      evidenceContext({
        fileName: 'محمد حازم و عمر خالد | فى السبعين مع سين جيم',
        durationSecs: 3_052,
        plan: {
          kinds: ['outcome'],
          requiresIdentityContext: true,
          requiresInspectionWhenInsufficient: true,
        },
        search: () => [
          reconciled('state-1', 1_024, 'the left label reads 1000 and the right label reads 1200'),
          reconciled('state-2', 1_561, 'the left label reads 1800 and the right label reads 2800'),
          reconciled('state-3', 2_756, 'the left label reads 2000 and the right label reads 3800'),
        ],
        reWatch,
      }),
    );

    expect(reWatch).toHaveBeenCalledTimes(1);
    expect(result.investigation.answerPath).toBe('rag+rewatch');
    expect(result.claimVerification.status).toBe('directly-established');
  });

  it('uses an indexed transition to inspect the source and removes an appended source title from retrieval', async () => {
    let inspected = false;
    const fetcher = vi.fn(async () => {
      inspected = true;
      return Response.json({ evidence: [{ id: 'fresh-evidence' }] });
    }) as any;
    const queries: string[] = [];
    const title = 'محمد طارق و مصطفى صدقي في السبعين مع سين جيم';
    const question = 'which team won this match';
    const visual = {
      ...hit(
        'visual-final',
        2_863,
        'The right side finishes ahead while the left side remains behind.',
      ),
      components: { lexical: 0.2 },
    };
    const reconciled = {
      ...hit('computed-final', 2_863, 'Reconciled state: the right side finishes ahead.', {
        modality: 'computed',
        source: { kind: 'provider', provider: 'video-intelligence-index' },
      } as any),
      components: { lexical: 0.2 },
    };

    const result = (await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: `which team won this match ${title}` },
      evidenceContext({
        fileName: title,
        durationSecs: 3_137,
        plan: {
          kinds: ['outcome', 'comparison'],
          requiresIdentityContext: true,
          requiresInspectionWhenInsufficient: true,
        },
        search: (query) => {
          queries.push(query);
          return inspected
            ? [directVerdict('verified-final', 2_863, question, 'the right side')]
            : [visual, reconciled];
        },
      }),
    )) as any;

    expect(queries.filter(Boolean)).toEqual(expect.arrayContaining(['which team won this match']));
    expect(queries.filter(Boolean)).not.toContain(`which team won this match ${title}`);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      startSecs: 2_763.3,
      endSecs: 2_823.3,
      maxFrames: 8,
      analysisMode: 'fast',
      includeSpeech: true,
    });
    expect(result).toMatchObject({
      claimVerification: {
        status: 'directly-established',
        directlyEstablished: true,
      },
      investigation: { answerPath: 'rag+analysis' },
    });
    expect(result.evidence.map((item: any) => item.id)).toEqual(['verified-final']);
  });

  it('still declines when the evidence has no bearing on the claim at all', async () => {
    const fetcher = vi.fn(async () => Response.json({ evidence: [] })) as any;

    const result = (await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'which side finished ahead' },
      evidenceContext({
        plan: { kinds: ['outcome'], requiresInspectionWhenInsufficient: true },
        search: () => [hit('unrelated', 20, 'A caption unrelated to the question.')],
      }),
    )) as any;

    expect(result.claimVerification.status).toBe('needs-corroboration');
    expect(result.claimVerification.rule).toMatch(/did not show/i);
  });

  it('does not reuse a reading that explicitly failed to establish the same question', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ evidence: [{ id: 'fresh-evidence' }] }),
    ) as any;
    const question = 'How many people entered the room?';

    const result = (await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: question },
      evidenceContext({
        plan: { kinds: ['counting'], requiresInspectionWhenInsufficient: true },
        search: () => [
          hit(
            'inconclusive',
            30,
            `Claim question: ${question}\nClaim verdict: not-established\nClaim answer:`,
          ),
        ],
      }),
    )) as any;

    expect(result.claimVerification.directlyEstablished).toBe(false);
  });

  it('reports an unavailable analysis service instead of claiming the video has no answer', async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        { error: 'Video analysis is already working on another request.' },
        { status: 429 },
      ),
    ) as any;

    const result = await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'What was the final decision?' },
      evidenceContext({
        plan: { kinds: ['outcome'], requiresInspectionWhenInsufficient: true },
        // Nothing indexed, so there is nothing to fall back on.
        search: () => [],
      }),
    );

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('analysis-service issue'),
    });
  });

  it('watches the source when the index has nothing to say about the question', async () => {
    const fetcher = vi.fn(async () => Response.json({ evidence: [{ id: 'fresh' }] })) as any;

    await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'What colour was the front door?' },
      evidenceContext({
        durationSecs: 600,
        plan: { kinds: ['visual-fact'], requiresInspectionWhenInsufficient: true },
        // Nothing indexed matches, which is the strongest reason to look.
        search: () => [],
      }),
    );

    expect(fetcher).toHaveBeenCalled();
  });

  it('does not reuse a nearby clip that directly answered a different question', async () => {
    const requestedQuestion = 'What color is the background in the opening fifteen seconds?';
    const earlierQuestion = 'What can be directly identified in the first fifteen seconds?';
    let inspected = false;
    const fetcher = vi.fn(async () => {
      inspected = true;
      return Response.json({ evidence: [{ id: 'fresh-background-read' }] });
    }) as any;

    await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: requestedQuestion },
      evidenceContext({
        durationSecs: 120,
        plan: { kinds: ['visual-fact'], requiresInspectionWhenInsufficient: true },
        search: () =>
          inspected
            ? [directVerdict('fresh', 0, requestedQuestion, 'the background is blue')]
            : [
                directVerdict(
                  'nearby-but-different',
                  0,
                  earlierQuestion,
                  'four people in a studio',
                ),
              ],
      }),
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('honors an opening-range request ahead of a semantically similar later hit', async () => {
    const fetcher = vi.fn(async () => Response.json({ evidence: [{ id: 'opening-read' }] })) as any;

    await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'What color is the background in the opening 15 seconds?' },
      evidenceContext({
        durationSecs: 3_000,
        plan: { kinds: ['visual-fact'], requiresInspectionWhenInsufficient: true },
        search: () => [hit('similar-late-shot', 2_850, 'A studio background is visible.')],
      }),
    );

    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      startSecs: 0,
      endSecs: 15,
    });
  });

  it('still answers from the index when a closer look cannot run', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ error: 'Video analysis is unavailable.' }, { status: 503 }),
    ) as any;

    const result = (await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'What was the final decision?' },
      evidenceContext({
        plan: { kinds: ['outcome'], requiresInspectionWhenInsufficient: true },
        search: () => [
          hit('a', 80, 'The chair states the motion carried.'),
          hit('b', 100, 'The room applauds after the announcement.'),
        ],
      }),
    )) as any;

    // A service that cannot run leaves the claim unverified; it does not
    // erase what the index recorded, so the turn still returns that.
    expect(fetcher).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.claimVerification.directlyEstablished).toBe(false);
    expect(result.claimVerification.rule).toMatch(/could not run/i);
  });

  it('watches independent ranges at the same time instead of one after another', async () => {
    let active = 0;
    let maximumActive = 0;
    const fetcher = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return Response.json({ evidence: [{ id: 'fresh-coverage-evidence' }] });
    }) as any;

    await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'Summarize the whole recording.' },
      evidenceContext({
        durationSecs: 7_200,
        plan: {
          kinds: ['coverage'],
          requiresBroadCoverage: true,
          requiresInspectionWhenInsufficient: true,
        },
        planInvestigation: async () => ({
          candidateRanges: [
            { startSecs: 100, endSecs: 140, reason: 'chapter one' },
            { startSecs: 5_000, endSecs: 5_050, reason: 'chapter two' },
          ],
          coverage: { mode: 'broad', totalChapters: 2, totalScenes: 2, representedRanges: 2 },
        }),
        // Never enough coverage, so every planned range is visited.
        search: () => [],
      }),
    );

    expect(maximumActive).toBeGreaterThan(1);
  });

  it('drops back to one range at a time when the runtime says it is busy', async () => {
    let active = 0;
    let maximumActive = 0;
    let served = 0;
    // A runtime that admits one job at a time: whoever arrives while another
    // is running is turned away with a busy signal.
    const fetcher = vi.fn(async () => {
      if (active > 0) return Response.json({ error: 'busy', serviceBusy: true }, { status: 429 });
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      served += 1;
      return Response.json({ evidence: [{ id: `evidence-${served}` }] });
    }) as any;

    const result = (await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'Summarize the whole recording.' },
      evidenceContext({
        durationSecs: 3_600,
        plan: {
          kinds: ['coverage'],
          requiresBroadCoverage: true,
          requiresInspectionWhenInsufficient: true,
        },
        search: () => [],
      }),
    )) as any;

    // The first wave went out together; the turned-away ranges were retried
    // one at a time rather than failing the turn.
    expect(fetcher.mock.calls.length).toBeGreaterThan(served);
    expect(served).toBeGreaterThan(1);
    expect(maximumActive).toBe(1);
    expect(result.success).toBe(true);
  });

  it('stops watching once a wave of looks has answered the question', async () => {
    let inspected = false;
    const fetcher = vi.fn(async () => {
      inspected = true;
      return Response.json({ evidence: [{ id: 'fresh-evidence' }] });
    }) as any;
    const question = 'What is on the whiteboard?';

    await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: question },
      evidenceContext({
        durationSecs: 3_600,
        plan: { kinds: ['visual-fact'], requiresInspectionWhenInsufficient: true },
        search: () =>
          inspected
            ? [directVerdict('answered', 30, question, 'a diagram of the pipeline')]
            : [
                hit('a', 30, 'A room with a whiteboard.'),
                hit('b', 900, 'The same room later.'),
                hit('c', 1_800, 'The room from another angle.'),
              ],
      }),
    );

    // One wave settled it, so the remaining candidate ranges are never run.
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('spreads coverage looks across the source rather than clustering them', async () => {
    const fetcher = vi.fn(async () => Response.json({ evidence: [{ id: 'fresh' }] })) as any;

    await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'Summarize the whole recording.' },
      evidenceContext({
        durationSecs: 7_200,
        plan: {
          kinds: ['coverage'],
          requiresBroadCoverage: true,
          requiresInspectionWhenInsufficient: true,
        },
        // Retrieval only found the opening; the rest must come from anchors.
        search: () => [hit('opening', 5, 'The recording opens.')],
      }),
    );

    const starts = fetcher.mock.calls.map((call: any) => JSON.parse(call[1].body).startSecs);
    expect(Math.max(...starts) - Math.min(...starts)).toBeGreaterThan(7_200 * 0.5);
  });

  it('returns coverage evidence in the order it occurred', async () => {
    const fetcher = vi.fn() as any;
    const question = 'Summarize the whole recording.';

    const result = (await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: question },
      evidenceContext({
        durationSecs: 600,
        plan: {
          kinds: ['coverage'],
          requiresBroadCoverage: true,
          requiresInspectionWhenInsufficient: true,
        },
        planInvestigation: async () => ({
          candidateRanges: [],
          coverage: { mode: 'broad', totalChapters: 3, totalScenes: 3, representedRanges: 3 },
        }),
        search: () => [
          hit('late', 480, 'The closing remarks.'),
          hit('early', 20, 'The opening remarks.'),
          hit('middle', 240, 'The main discussion.'),
        ],
      }),
    )) as any;

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.claimVerification.directlyEstablished).toBe(true);
    expect(result.evidence.map((item: any) => item.id)).toEqual(['early', 'middle', 'late']);
  });

  it('paginates exhaustive source-wide requests instead of truncating them to top-k', async () => {
    const sourceHits = Array.from({ length: 50 }, (_, index) =>
      hit(`item-${index}`, index * 12, `Chronological item ${index}.`),
    );
    const context = evidenceContext({
      durationSecs: 600,
      plan: {
        kinds: ['coverage'],
        requiresBroadCoverage: true,
        requiresInspectionWhenInsufficient: true,
      },
      search: () => sourceHits,
    });

    const first = (await agentClient(vi.fn() as any).queryVideoEvidence(
      {
        mediaAssetId: 'media-1',
        query: 'List every item mentioned.',
        exhaustive: true,
        limit: 12,
      },
      context,
    )) as any;
    const second = (await agentClient(vi.fn() as any).queryVideoEvidence(
      {
        mediaAssetId: 'media-1',
        query: 'List every item mentioned.',
        exhaustive: true,
        limit: 12,
        cursor: first.continuation.nextCursor,
      },
      context,
    )) as any;

    expect(first.evidence).toHaveLength(12);
    expect(first.evidence[0].id).toBe('item-0');
    expect(first.continuation).toMatchObject({
      totalItems: 50,
      returnedItems: 12,
      hasMore: true,
      nextCursor: 12,
    });
    expect(second.evidence[0].id).toBe('item-12');
    expect(second.continuation.nextCursor).toBe(24);
  });

  it('returns only source-authored questions for an exhaustive question inventory', async () => {
    const noise = Array.from({ length: 50 }, (_, index) =>
      hit(`noise-${index}`, index * 10, `Ordinary source note ${index}.`),
    );
    const questions = Array.from({ length: 6 }, (_, index) =>
      hit(
        `question-${index}`,
        index * 110,
        `Round ${index} asks the participants to identify a source detail.\n` +
          `Source question (spoken): Source prompt ${index}?\n` +
          `Source answer: Source answer ${index}`,
        {
          modality: 'computed',
          source: { kind: 'provider', provider: 'video-intelligence-index' },
        },
      ),
    );
    const meta = hit(
      'meta',
      15,
      'Claim question: What the person reading these notes cares about most?',
      {
        modality: 'computed',
        source: { kind: 'provider', provider: 'video-intelligence-index' },
      },
    );
    const laterChatQuestion = hit('inspection-question', 220, 'Claim question: who won?', {
      modality: 'computed',
      source: { kind: 'provider', provider: 'video-intelligence-vision' },
    });
    const analysisQuestion = hit(
      'analysis-question',
      330,
      'The segment shows the current state of a quiz and its score.\n' +
        'Claim question: What is the status of the quiz?\n' +
        'Claim verdict: direct\n' +
        'Claim answer: The round has ended.',
      {
        modality: 'computed',
        source: { kind: 'provider', provider: 'video-intelligence-index' },
      },
    );

    const result = (await agentClient(vi.fn() as any).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'List all questions in the recording.' },
      evidenceContext({
        durationSecs: 600,
        plan: {
          kinds: ['coverage', 'question-inventory'],
          requiresBroadCoverage: true,
          requiresInspectionWhenInsufficient: false,
        },
        search: () => [...noise, meta, laterChatQuestion, analysisQuestion, ...questions],
      }),
    )) as any;

    expect(result.evidence).toHaveLength(6);
    expect(result.evidence.map((item: any) => item.payload.text)).toEqual(
      questions.map(
        (_, index) =>
          `Question: Source prompt ${index}?\n` +
          `Context: Round ${index} asks the participants to identify a source detail.\n` +
          `Answer: Source answer ${index}`,
      ),
    );
    expect(result.continuation).toMatchObject({ totalItems: 6, hasMore: false });
  });

  it('keeps multiple source questions from one clip and ignores a supplied analysis question', async () => {
    const result = (await agentClient(vi.fn() as any).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'List every question asked.' },
      evidenceContext({
        durationSecs: 60,
        plan: {
          kinds: ['coverage', 'question-inventory'],
          requiresBroadCoverage: true,
          requiresInspectionWhenInsufficient: false,
        },
        search: () => [
          hit(
            'two-source-questions',
            10,
            'Two prompts are asked in this round.\n' +
              'Source question (visible): Which option is correct?\n' +
              'Source answer: Option B\n' +
              'Source question (spoken): Why did it happen?\n' +
              'Claim question: List every question asked.\n' +
              'Claim verdict: partial',
            {
              modality: 'computed',
              source: { kind: 'provider', provider: 'video-intelligence-index' },
            },
          ),
        ],
      }),
    )) as any;

    expect(result.evidence.map((item: any) => item.payload.text)).toEqual([
      'Question: Which option is correct?\nContext: Two prompts are asked in this round.\nAnswer: Option B',
      'Question: Why did it happen?\nContext: Two prompts are asked in this round.',
    ]);
  });

  it('rejects spoken answer fragments mislabeled as source questions', async () => {
    const result = (await agentClient(vi.fn() as any).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'List every question asked.' },
      evidenceContext({
        durationSecs: 120,
        plan: {
          kinds: ['coverage', 'question-inventory'],
          requiresBroadCoverage: true,
          requiresInspectionWhenInsufficient: false,
        },
        search: () => [
          hit(
            'inventory',
            10,
            'Source question (visible): Identify the player\n' +
              'Source question (spoken): في أي سنة حدث ذلك\n' +
              'Source question (spoken): صح صح هما الاثنين صح ماشي',
            {
              modality: 'computed',
              source: { kind: 'provider', provider: 'video-intelligence-index' },
            },
          ),
        ],
      }),
    )) as any;

    expect(result.evidence.map((item: any) => item.payload.text)).toEqual([
      'Question: Identify the player',
      'Question: في أي سنة حدث ذلك',
    ]);
  });

  it('prefers a nearby complete visible prompt and rejects deictic spoken banter', async () => {
    const result = (await agentClient(vi.fn() as any).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'List every question asked.' },
      evidenceContext({
        durationSecs: 240,
        plan: {
          kinds: ['coverage', 'question-inventory'],
          requiresBroadCoverage: true,
          requiresInspectionWhenInsufficient: false,
        },
        search: () => [
          hit('spoken', 100, 'Source question (spoken): من هو مدرب بانما في كاس العالم 18', {
            modality: 'computed',
            source: { kind: 'provider', provider: 'video-intelligence-index' },
          }),
          hit('visible', 115, 'Source question (visible): من هو مدرب بنما في كأس العالم 2018؟', {
            modality: 'computed',
            source: { kind: 'provider', provider: 'video-intelligence-index' },
          }),
          hit('banter', 130, 'Source question (spoken): هي دي ايه بالظبط؟', {
            modality: 'computed',
            source: { kind: 'provider', provider: 'video-intelligence-index' },
          }),
        ],
      }),
    )) as any;

    expect(result.evidence.map((item: any) => item.payload.text)).toEqual([
      'Question: من هو مدرب بنما في كأس العالم 2018؟',
    ]);
  });

  it('does not promise a complete inventory from legacy inferred question fields', async () => {
    const result = (await agentClient(vi.fn() as any).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'List every question asked.' },
      evidenceContext({
        durationSecs: 60,
        plan: {
          kinds: ['coverage', 'question-inventory'],
          requiresBroadCoverage: true,
          requiresInspectionWhenInsufficient: false,
        },
        search: () => [
          hit(
            'legacy-visible-question',
            10,
            "A prompt is displayed.\nOn screen: 'Which option is correct?' — quiz question\n" +
              'Claim question: Which option is correct?\nClaim verdict: not-established',
            {
              modality: 'visual',
              source: { kind: 'provider', provider: 'video-intelligence-index' },
            },
          ),
        ],
      }),
    )) as any;

    expect(result.evidence).toHaveLength(1);
    expect(result.claimVerification.status).toBe('needs-corroboration');
    expect(result.claimVerification.rule).toContain('does not settle this');
  });

  it('collapses the same source question repeated by overlapping analysis clips', async () => {
    const question = "On screen: 'Which option is correct?' — quiz question";
    const result = (await agentClient(vi.fn() as any).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'List every question asked.' },
      evidenceContext({
        durationSecs: 120,
        plan: {
          kinds: ['coverage', 'question-inventory'],
          requiresBroadCoverage: true,
          requiresInspectionWhenInsufficient: false,
        },
        search: () => [
          hit('first-reading', 20, `First surrounding summary.\n${question}`),
          hit('overlapping-reading', 25, `Different surrounding summary.\n${question}`),
        ],
      }),
    )) as any;

    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].payload.text).toContain('Which option is correct?');
  });

  it('never promotes an echoed analyzer claim into a source-question inventory', async () => {
    const result = (await agentClient(vi.fn() as any).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'List every question asked.' },
      evidenceContext({
        durationSecs: 60,
        plan: {
          kinds: ['coverage', 'question-inventory'],
          requiresBroadCoverage: true,
          requiresInspectionWhenInsufficient: false,
        },
        search: () => [
          hit(
            'analysis-score-question',
            10,
            'The game continues with a question about a manager, leading to a score change ' +
              'where both teams have updated scores.\n' +
              'Claim question: What are the updated scores for both teams?\n' +
              'Claim verdict: direct\n' +
              'Claim answer: 400 and 600',
          ),
        ],
      }),
    )) as any;

    expect(result.evidence).toHaveLength(0);
    expect(result.claimVerification.status).toBe('needs-corroboration');
  });

  it('returns a complete indexed inventory of visible source units without narrative noise', async () => {
    const result = (await agentClient(vi.fn() as any).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'List every slide heading and item.' },
      evidenceContext({
        durationSecs: 600,
        plan: {
          kinds: ['coverage', 'source-inventory'],
          requiresBroadCoverage: true,
          requiresInspectionWhenInsufficient: false,
        },
        search: () => [
          hit('heading', 10, 'Source item (heading, visible): Introduction', {
            modality: 'computed',
            source: { kind: 'provider', provider: 'video-intelligence-index' },
          }),
          hit('slide', 20, 'Source item (slide-item, visible): First supported point', {
            modality: 'computed',
            source: { kind: 'provider', provider: 'video-intelligence-index' },
          }),
          hit('board', 30, 'Source item (board-item, visible): unrelated board note', {
            modality: 'computed',
            source: { kind: 'provider', provider: 'video-intelligence-index' },
          }),
          hit('noise', 40, 'Chronological note: someone walks across the room.'),
        ],
      }),
    )) as any;

    expect(result.claimVerification.status).toBe('directly-established');
    expect(result.evidence.map((item: any) => item.id)).toEqual(['heading', 'slide']);
    expect(result.continuation).toMatchObject({ totalItems: 2, hasMore: false });
  });

  it('does not rank participation from one identity card and unrelated scenery', async () => {
    const reWatch = vi.fn(async () => [
      {
        found: 'Mina answers twice while Sara asks a follow-up.',
        settlesQuestion: true,
        range: { startSecs: 30, endSecs: 60 },
      },
    ]);
    const result = (await agentClient(vi.fn() as any).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'Who participated the most?' },
      evidenceContext({
        durationSecs: 600,
        plan: {
          kinds: ['coverage', 'evaluation'],
          requiresBroadCoverage: true,
          requiresInspectionWhenInsufficient: true,
        },
        search: () => [
          hit('decor', 5, 'Reconciled context: a logo is on the wall.', {
            modality: 'computed',
            source: { kind: 'provider', provider: 'video-intelligence-index' },
          }),
          hit(
            'identity-card',
            20,
            'Two people are introduced.\nPresent: Mina — participant\nPresent: Sara — participant',
          ),
        ],
        reWatch,
      }),
    )) as any;

    expect(reWatch).toHaveBeenCalled();
    expect(result.investigation.answerPath).toBe('rag+rewatch');
  });

  it('carries the indexed trajectory so an early state is not mistaken for the ending', async () => {
    const states = [
      hit('early-state', 190, 'Reconciled state: Alpha 13, Beta 11.', {
        modality: 'computed',
        source: { kind: 'provider', provider: 'video-intelligence-index' },
      }),
      hit('later-state', 2_590, 'Reconciled state: Left 1400, Right 3800.', {
        modality: 'computed',
        source: { kind: 'provider', provider: 'video-intelligence-index' },
      }),
      hit('ending-state', 2_867, 'Reconciled state: Left 2600, Right 3800.', {
        modality: 'computed',
        source: { kind: 'provider', provider: 'video-intelligence-index' },
      }),
    ];
    const result = (await agentClient(vi.fn() as any).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'Who won?' },
      evidenceContext({
        durationSecs: 3_052,
        plan: { kinds: ['outcome'], requiresInspectionWhenInsufficient: true },
        search: () => states,
      }),
    )) as any;

    expect(result.temporalContext.readings.map((item: any) => item.atSecs)).toEqual([
      190, 2_590, 2_867,
    ]);
    expect(result.temporalContext.rule).toMatch(/different scopes|scope boundary/i);
  });

  it('reads the compact computed timeline before a long raw timeline can hide the ending', async () => {
    const states = [
      hit('penultimate-state', 2_720, 'Reconciled state: Left 3200, Right 3800.', {
        modality: 'computed',
        source: { kind: 'provider', provider: 'video-intelligence-index' },
      }),
      hit('final-state', 2_890, 'Reconciled state: Left 3200, Right 4000.', {
        modality: 'computed',
        source: { kind: 'provider', provider: 'video-intelligence-index' },
      }),
    ];
    const search = vi.fn((query: string, options?: Record<string, unknown>) =>
      query === '' && (options?.modalities as string[] | undefined)?.includes('computed')
        ? states
        : [],
    );

    const result = (await agentClient(vi.fn() as any).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'Which side won?' },
      evidenceContext({
        durationSecs: 3_052,
        plan: { kinds: ['outcome'], requiresInspectionWhenInsufficient: true },
        search,
      }),
    )) as any;

    expect(
      search.mock.calls.some(
        (call) =>
          call[0] === '' && (call[1]?.modalities as string[] | undefined)?.includes('computed'),
      ),
    ).toBe(true);
    expect(result.temporalContext.readings.at(-1)).toMatchObject({ atSecs: 2_890 });
    expect(result.investigation.answerPath).toBe('rag');
  });

  it('automatically enables exhaustive indexed retrieval for whole-source questions', async () => {
    const search = vi.fn(() => [
      hit('opening', 0, 'The opening.'),
      hit('middle', 300, 'The middle.'),
      hit('closing', 590, 'The closing.'),
    ]);

    const result = (await agentClient(vi.fn() as any).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'List everything covered in the recording.' },
      evidenceContext({
        durationSecs: 600,
        plan: {
          kinds: ['coverage'],
          requiresBroadCoverage: true,
          requiresInspectionWhenInsufficient: true,
        },
        search,
      }),
    )) as any;

    expect(search.mock.calls.some((call) => call[0] === '' && call[2] === 2_000)).toBe(true);
    expect(result.continuation).toMatchObject({
      totalItems: 3,
      returnedItems: 3,
      hasMore: false,
    });
  });

  it('treats sparse evidence from one corner of a long source as incomplete coverage', async () => {
    const fetcher = vi.fn(async () => Response.json({ evidence: [{ id: 'fresh' }] })) as any;

    const result = (await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'Summarize the whole recording.' },
      evidenceContext({
        durationSecs: 7_200,
        plan: {
          kinds: ['coverage'],
          requiresBroadCoverage: true,
          requiresInspectionWhenInsufficient: true,
        },
        search: () => [hit('a', 10, 'One'), hit('b', 20, 'Two'), hit('c', 30, 'Three')],
      }),
    )) as any;

    expect(fetcher).toHaveBeenCalled();
    expect(result.investigation.answerPath).toBe('rag+analysis');
  });

  it('reads visible values closely and ordinary scenes quickly', async () => {
    const closeRead = vi.fn(async () => Response.json({ evidence: [{ id: 'fresh' }] })) as any;
    await agentClient(closeRead).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'What version number is on the screen?' },
      evidenceContext({
        plan: { kinds: ['exact-ocr'], requiresInspectionWhenInsufficient: true },
        search: () => [hit('anchor', 30, 'Someone is typing.')],
      }),
    );
    expect(JSON.parse(closeRead.mock.calls[0][1].body)).toMatchObject({
      analysisMode: 'thorough',
      purpose: 'high-res-ocr',
    });

    const quickRead = vi.fn(async () => Response.json({ evidence: [{ id: 'fresh' }] })) as any;
    await agentClient(quickRead).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'What happened in order?' },
      evidenceContext({
        plan: {
          kinds: ['state-change'],
          requiresBothRanges: true,
          requiresInspectionWhenInsufficient: true,
        },
        search: () => [hit('anchor', 30, 'Someone is typing.')],
      }),
    );
    expect(JSON.parse(quickRead.mock.calls[0][1].body)).toMatchObject({
      analysisMode: 'fast',
      includeSpeech: true,
      purpose: 'high-res-ocr',
      maxFrames: 24,
    });
  });

  it('carries indexed participant identities into a multi-subject visual comparison', async () => {
    const fetcher = vi.fn(async () => Response.json({ evidence: [{ id: 'fresh' }] })) as any;

    await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'What were the participants wearing?' },
      evidenceContext({
        plan: {
          kinds: ['comparison', 'person-attribute'],
          requiresIdentityContext: true,
          requiresInspectionWhenInsufficient: true,
        },
        search: () => [
          hit('alpha', 10, 'Reconciled participant: Alpha Group — presenter'),
          hit('beta', 40, 'Indexed participant: Beta Group — audience'),
        ],
      }),
    );

    expect(JSON.parse(fetcher.mock.calls[0][1].body).knownEntities).toEqual([
      'Alpha Group',
      'Beta Group',
    ]);
  });

  it('answers a per-subject attribute question from corroborated RAG descriptions without waiting for analysis', async () => {
    const fetcher = vi.fn() as any;
    const question = 'Can you tell me each one what he was wearing?';
    const visual = hit(
      'visual-outfits',
      30,
      'The left participant wears an orange shirt; the right participant wears a dark green shirt.',
    );
    const reconciled = {
      ...hit(
        'reconciled-outfits',
        30,
        'Reconciled context: the left participant wears an orange shirt and the right participant wears a dark green shirt.',
        { modality: 'computed' },
      ),
      evidence: {
        ...hit('unused', 30, '').evidence,
        id: 'reconciled-outfits',
        modality: 'computed',
        payload:
          'Reconciled context: the left participant wears an orange shirt and the right participant wears a dark green shirt.',
        source: { kind: 'provider', provider: 'video-intelligence-index' },
      },
    } as any;

    const result = (await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: question },
      evidenceContext({
        plan: {
          kinds: ['comparison', 'person-attribute'],
          requiresIdentityContext: true,
          requiresInspectionWhenInsufficient: true,
        },
        search: () => [visual, reconciled],
      }),
    )) as any;

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.claimVerification.status).toBe('established-by-trail');
    expect(result.claimVerification.directlyEstablished).toBe(false);
    expect(result.investigation.answerPath).toBe('rag');
    expect(result.evidence.map((item: any) => item.id)).toEqual(
      expect.arrayContaining(['visual-outfits', 'reconciled-outfits']),
    );
  });

  it('uses a semantically matched indexed visual description before starting a live attribute analysis', async () => {
    const fetcher = vi.fn() as any;
    const question = 'Can you tell me each one what he was wearing?';
    const visual = {
      ...hit(
        'indexed-outfits',
        30,
        'The left participant wears an orange shirt; the right participant wears a dark green shirt.',
      ),
      components: { semantic: 0.91, lexical: 0 },
    };

    const result = (await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: question },
      evidenceContext({
        plan: {
          kinds: ['comparison', 'person-attribute'],
          requiresIdentityContext: true,
          requiresInspectionWhenInsufficient: true,
        },
        search: () => [visual],
      }),
    )) as any;

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.claimVerification.status).toBe('established-by-trail');
    expect(result.investigation.answerPath).toBe('rag');
    expect(result.evidence).toEqual([expect.objectContaining({ id: 'indexed-outfits' })]);
    expect(result.claimVerification.rule).toContain(
      'personal name is not automatically established',
    );
  });

  it('re-watches when a group count is wider than the people whose attributes were described', async () => {
    const reWatch = vi.fn(async () => [
      {
        range: { startSecs: 0, endSecs: 60 },
        found: 'All four people are described separately.',
        settlesQuestion: true,
        read: [],
        confidence: 'high' as const,
      },
    ]);

    const result = (await agentClient(vi.fn() as any).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'What was each person wearing?' },
      evidenceContext({
        durationSecs: 600,
        plan: {
          kinds: ['comparison', 'person-attribute'],
          requiresIdentityContext: true,
          requiresInspectionWhenInsufficient: true,
        },
        search: () => [
          hit('wide-group', 300, 'Four men sit together while one man wearing blue speaks.'),
          hit('one-outfit', 10, 'A man wearing a black jersey speaks to the camera.'),
          hit('second-outfit', 140, 'One man wears white while his companion listens.'),
        ],
        reWatch,
      }),
    )) as any;

    expect(reWatch).toHaveBeenCalled();
    expect(result.investigation.answerPath).toBe('rag+rewatch');
  });

  it('re-watches when named people are not bound to the indexed visual attributes', async () => {
    const reWatch = vi.fn(async () => [
      {
        range: { startSecs: 0, endSecs: 60 },
        at: '0:00–1:00',
        found: 'Ragab wears orange and Omar wears dark green.',
        settlesQuestion: true,
        read: [],
        confidence: 'high' as const,
      },
    ]);
    const indexed = [
      hit('visual-outfits', 30, 'The left person wears orange; the right person wears dark green.'),
      hit('ragab-anchor', 5, 'Reconciled participant: Ragab — introduced by name.', {
        modality: 'computed',
        source: { kind: 'provider', provider: 'video-intelligence-index' },
      }),
      hit('omar-anchor', 8, 'Reconciled participant: Omar — introduced by name.', {
        modality: 'computed',
        source: { kind: 'provider', provider: 'video-intelligence-index' },
      }),
    ];

    const result = (await agentClient(vi.fn() as any).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'What were Ragab and Omar wearing?' },
      evidenceContext({
        plan: {
          kinds: ['comparison', 'person-attribute'],
          requiresIdentityContext: true,
          requiresInspectionWhenInsufficient: true,
        },
        search: () => indexed,
        reWatch,
      }),
    )) as any;

    expect(reWatch).toHaveBeenCalledTimes(1);
    expect(reWatch.mock.calls[0][3]).toEqual(
      expect.objectContaining({ knownEntities: expect.arrayContaining(['Ragab', 'Omar']) }),
    );
    expect(result.directObservation.readings[0].found).toContain('Ragab wears orange');
  });

  it('uses the fast reader for an unresolved unnamed multi-person attribute question', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ evidence: [{ id: 'fresh-evidence' }] }),
    ) as any;

    await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'Can you tell me each one what he was wearing?' },
      evidenceContext({
        plan: {
          kinds: ['comparison', 'person-attribute'],
          requiresIdentityContext: true,
          requiresInspectionWhenInsufficient: true,
        },
        search: () => [],
      }),
    );

    expect(fetcher).toHaveBeenCalled();
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      analysisMode: 'fast',
      maxFrames: 8,
    });
  });

  it('includes the widest indexed group moment when re-watching a per-person attribute', async () => {
    const reWatch = vi.fn(async () => [
      {
        found: 'Four people are visible with distinct source-supported attributes.',
        settlesQuestion: true,
        range: { startSecs: 285, endSecs: 325 },
      },
    ]);

    await agentClient(vi.fn() as any).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'What was each person wearing?' },
      evidenceContext({
        durationSecs: 600,
        plan: {
          kinds: ['comparison', 'person-attribute'],
          requiresIdentityContext: true,
          requiresInspectionWhenInsufficient: true,
        },
        search: () => [
          hit(
            'pair',
            10,
            'Two people talk.\nPresent: Person A — person\nPresent: Person B — person',
          ),
          hit('group', 300, 'Four people sit together in the room.'),
        ],
        reWatch,
      }),
    );

    const ranges = reWatch.mock.calls[0][2] as Array<{ startSecs: number; endSecs: number }>;
    expect(ranges.some((range) => range.startSecs <= 300 && range.endSecs >= 300)).toBe(true);
  });

  it('carries names established by reconciled state into identity comparison', async () => {
    const fetcher = vi.fn(async () => Response.json({ evidence: [{ id: 'fresh' }] })) as any;

    await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'Which appearance belonged to each named group?' },
      evidenceContext({
        plan: {
          kinds: ['comparison', 'person-attribute'],
          requiresIdentityContext: true,
          requiresInspectionWhenInsufficient: true,
        },
        search: () => [hit('groups', 10, 'Reconciled state: Northwind Group 2 - Contoso Labs 1')],
      }),
    );

    expect(JSON.parse(fetcher.mock.calls[0][1].body).knownEntities).toEqual([
      'Northwind Group',
      'Contoso Labs',
    ]);
  });

  it('answers ordered changes from a broad RAG timeline without launching analysis', async () => {
    const fetcher = vi.fn() as any;
    const sourceHits = [
      hit('early', 10, 'An early state.'),
      hit('middle', 310, 'A later state.'),
      hit('late', 590, 'The closing state.'),
    ];

    const result = (await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'Give the complete timeline of changes.' },
      evidenceContext({
        durationSecs: 600,
        plan: {
          kinds: ['state-change'],
          requiresBothRanges: true,
          requiresInspectionWhenInsufficient: true,
        },
        search: () => sourceHits,
      }),
    )) as any;

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.investigation.answerPath).toBe('rag');
    expect(result.evidence.map((item: any) => item.id)).toEqual(['early', 'middle', 'late']);
  });

  it('returns a reconciled state trajectory instead of every raw item for ordered changes', async () => {
    const fetcher = vi.fn() as any;
    const computed = (id: string, at: number, text: string) =>
      hit(id, at, text, {
        modality: 'computed',
        source: { kind: 'provider', provider: 'video-intelligence-index' },
      });
    const result = (await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'Give every change over time.', exhaustive: true },
      evidenceContext({
        durationSecs: 600,
        plan: {
          kinds: ['coverage', 'state-change'],
          requiresBroadCoverage: true,
          requiresInspectionWhenInsufficient: true,
        },
        search: () => [
          ...Array.from({ length: 100 }, (_, index) =>
            hit(`raw-${index}`, index * 5, `Unrelated raw observation ${index}.`),
          ),
          computed('state-1', 20, 'Reconciled state: value A.'),
          computed('noise-event', 30, 'Reconciled event: an unrelated prompt was missed.'),
          computed('change-1', 220, 'Reconciled event: value updated from A to B.'),
          computed('state-2', 500, 'Reconciled state: value B.'),
        ],
      }),
    )) as any;

    expect(result.evidence.map((item: any) => item.id)).toEqual(['state-1', 'change-1', 'state-2']);
    expect(result.continuation).toMatchObject({ totalItems: 3, hasMore: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('passes a named subject to the reader so the right person is described', async () => {
    const fetcher = vi.fn(async () => Response.json({ evidence: [{ id: 'fresh' }] })) as any;
    const searched: string[] = [];

    await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'What was Sara wearing?' },
      evidenceContext({
        plan: {
          kinds: ['person-attribute'],
          subjectName: 'Sara',
          requiresInspectionWhenInsufficient: true,
        },
        search: (query) => {
          searched.push(query);
          return [hit('scene', 30, 'Several people are visible.')];
        },
      }),
    );

    expect(searched).toContain('Sara');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ knownEntities: ['Sara'] });
  });

  it('looks at where the source ends when asked how something concluded', async () => {
    const fetcher = vi.fn(async () => Response.json({ evidence: [{ id: 'fresh' }] })) as any;

    await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'How did it end?' },
      evidenceContext({
        durationSecs: 900,
        plan: { kinds: ['outcome'], requiresInspectionWhenInsufficient: true },
        // Retrieval ranks a mid-source moment highest, because the closing
        // moments share none of the question's words.
        search: () => [hit('midpoint', 400, 'Something happens in the middle.')],
      }),
    );

    const inspected = fetcher.mock.calls.map((call: any) => JSON.parse(call[1].body));
    expect(inspected.some((body: any) => body.endSecs >= 900)).toBe(true);
  });

  it('accepts what it just watched as the answer, however the reader worded it', async () => {
    let watched = false;
    const fetcher = vi.fn(async () => {
      watched = true;
      return Response.json({ evidence: [{ id: 'fresh' }] });
    }) as any;

    const result = (await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'How did it end?' },
      evidenceContext({
        durationSecs: 900,
        plan: { kinds: ['outcome'], requiresInspectionWhenInsufficient: true },
        search: () =>
          watched
            ? [
                // Gathered by the look the agent just requested. Its reader
                // reworded the question, so no string match would find it.
                hit('watched', 870, 'The closing sequence shows the motion carried.', {
                  createdAt: new Date().toISOString(),
                }),
              ]
            : [hit('stale', 400, 'Something mid-recording.')],
      }),
    )) as any;

    expect(fetcher).toHaveBeenCalled();
    expect(result.claimVerification.directlyEstablished).toBe(true);
    expect(result.evidence[0].id).toBe('watched');
  });

  it('answers from what a watched moment showed, not from stray text read off it', async () => {
    let watched = false;
    const fetcher = vi.fn(async () => {
      watched = true;
      return Response.json({ evidence: [{ id: 'fresh' }] });
    }) as any;
    const freshly = () => ({ createdAt: new Date().toISOString() });

    const result = (await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'How did it end?' },
      evidenceContext({
        durationSecs: 900,
        plan: { kinds: ['outcome'], requiresInspectionWhenInsufficient: true },
        search: () =>
          watched
            ? [
                // Watching a moment yields far more raw fragments than
                // accounts, so the fragments arrive first.
                hit('fragment-1', 870, 'HD1', { modality: 'ocr', ...freshly() }),
                hit('fragment-2', 871, 'plus,', { modality: 'ocr', ...freshly() }),
                hit(
                  'overlay',
                  872,
                  { subject: 'on-screen-text', property: 'recurring-overlay', value: 'x' },
                  freshly(),
                ),
                hit('account', 873, 'The closing sequence shows the motion carried.', freshly()),
              ]
            : [hit('stale', 400, 'Something mid-recording.')],
      }),
    )) as any;

    expect(result.claimVerification.directlyEstablished).toBe(true);
    expect(result.evidence[0].id).toBe('account');
  });

  it('leads with the account that reconciled the readings, not a reading it set aside', async () => {
    const fetcher = vi.fn() as any;

    const result = (await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'What did the display show at the end?' },
      evidenceContext({
        plan: { kinds: ['direct-speech'], requiresInspectionWhenInsufficient: false },
        search: () => [
          hit('reading-a', 800, 'The display reads A ahead of B.'),
          hit('reading-b', 805, 'The display reads B ahead of A.'),
          hit('reconciled', 800, 'Reconciled state: the display reads A ahead of B.', {
            modality: 'computed',
            source: { kind: 'provider', provider: 'video-intelligence-index' },
          } as any),
        ],
      }),
    )) as any;

    expect(result.evidence[0].id).toBe('reconciled');
  });

  it('does not promote evidence that merely sits inside a watched range', async () => {
    const fetcher = vi.fn(async () => Response.json({ evidence: [{ id: 'fresh' }] })) as any;

    const result = (await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'How did it end?' },
      evidenceContext({
        durationSecs: 900,
        plan: { kinds: ['outcome'], requiresInspectionWhenInsufficient: true },
        // Already in the index before the look began, so it was not gathered
        // for this question and does not settle it.
        search: () => [hit('pre-existing', 880, 'A moment near the end.')],
      }),
    )) as any;

    expect(fetcher).toHaveBeenCalled();
    expect(result.claimVerification.directlyEstablished).toBe(false);
  });

  it('does not reuse a verified answer to a different question that shares only common words', async () => {
    const fetcher = vi.fn(async () => Response.json({ evidence: [{ id: 'fresh' }] })) as any;

    const result = (await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'What shirt number was the goalkeeper wearing?' },
      evidenceContext({
        plan: {
          kinds: ['person-attribute'],
          subjectName: 'goalkeeper',
          requiresInspectionWhenInsufficient: true,
        },
        // A settled answer to an unrelated question. It shares "what", "was"
        // and "the" with the asked one, and nothing else.
        search: () => [directVerdict('other', 60, 'What was the score?', '2-1')],
      }),
    )) as any;

    expect(result.claimVerification.directlyEstablished).toBe(false);
    expect(fetcher).toHaveBeenCalled();
  });

  it('reuses a verified answer across a genuine rewording of the same question', async () => {
    const fetcher = vi.fn() as any;

    const result = (await agentClient(fetcher).queryVideoEvidence(
      { mediaAssetId: 'media-1', query: 'How many people entered?' },
      evidenceContext({
        plan: { kinds: ['counting'], requiresInspectionWhenInsufficient: true },
        search: () => [directVerdict('same', 60, 'How many people entered the room?', 'four')],
      }),
    )) as any;

    expect(result.claimVerification.directlyEstablished).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('carries no vocabulary specific to one kind of video', () => {
    const source = readFileSync(new URL('./agent.ts', import.meta.url), 'utf8').toLowerCase();
    for (const domainWord of [
      'scoreboard',
      'goal',
      'assist',
      'winner',
      'football',
      'lecture',
      'celebration',
      'replay',
      'terminal',
    ]) {
      expect(source, `agent.ts should not branch on "${domainWord}"`).not.toContain(domainWord);
    }
  });
});
