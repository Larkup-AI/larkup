import { describe, expect, it } from 'vitest';
import type { MediaAsset } from '@larkup/core/types';
import {
  assertVideoIntelligenceConfiguration,
  shouldRequireSemanticVideoEvidence,
  shouldSkipCloudTranscription,
  shouldSkipCloudVideoEmbeddings,
  createVideoIntelligenceSubmitRequest,
  shouldSkipHeavyVideoOperators,
  evidenceToSegments,
  cloudOverallToStagePercent,
  cloudStageProgress,
  evidenceToKnowledgeInputs,
  evidenceToRefinementInputs,
  enforceManagedSemanticBrief,
  inferLanguageHintFromTitle,
  formatVideoKnowledgeSummary,
  resolveVideoJobModelConfiguration,
} from './video-intelligence-adapter';

describe('inferLanguageHintFromTitle', () => {
  it('uses a high-confidence non-Latin script without an AI request', () => {
    expect(inferLanguageHintFromTitle('ملخص مباراة الهلال والزمالك')).toBe('ar');
    expect(inferLanguageHintFromTitle('한국 축구 경기')).toBe('ko');
    expect(inferLanguageHintFromTitle('Український матч')).toBe('uk');
  });

  it('leaves ambiguous Latin titles on automatic multilingual recognition', () => {
    expect(inferLanguageHintFromTitle('Champions League Final')).toBeUndefined();
  });
});

describe('evidenceToSegments', () => {
  it('indexes semantic video observations when no transcript, OCR, or objects are available', () => {
    const segments = evidenceToSegments({
      durationMs: 90_000,
      video: { width: 1920, height: 1080, fps: 30 },
      transcript: [],
      visualObservations: [],
      tracks: [],
      semanticObservations: [
        {
          startMs: 12_000,
          endMs: 18_000,
          text: 'A player scores from inside the penalty area.',
          confidence: 0.92,
        },
      ],
      answeringGuide: {
        importantEntities: [],
        questionsToPrepareFor: [],
        instruction: '',
      },
    });

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      startSecs: 0,
      endSecs: 30,
      // The note is indexed as written. A "Video scene:" prefix on every entry
      // is a label the reader has to look past, not information.
      visualContext: 'A player scores from inside the penalty area.',
    });
  });

  it('keeps detector class lists and low-confidence text out of the indexed notes', () => {
    const segments = evidenceToSegments({
      durationMs: 30_000,
      video: { width: 1920, height: 1080, fps: 30 },
      transcript: [],
      visualObservations: [
        {
          timeMs: 5_000,
          objects: [
            { label: 'person', trackId: 1, confidence: 0.9 },
            { label: 'chair', trackId: 2, confidence: 0.8 },
          ],
          ocr: [
            { text: 'GATE 4 OPEN', confidence: 0.93 },
            { text: 'rn1lI', confidence: 0.5 },
          ],
        },
      ],
      tracks: [],
      semanticObservations: [
        { startMs: 4_000, endMs: 8_000, text: 'The gate is opened.', confidence: 0.9 },
      ],
      answeringGuide: { importantEntities: [], questionsToPrepareFor: [], instruction: '' },
    });

    const indexed = segments[0].visualContext ?? '';
    // A class list is what made an indexed video read as "person, chair, couch".
    expect(indexed).not.toMatch(/person/);
    expect(indexed).not.toMatch(/chair/);
    // A confident reading is often exactly what a later question turns on.
    expect(indexed).toContain('GATE 4 OPEN');
    // A garbled low-confidence read is noise wearing the same clothes.
    expect(indexed).not.toContain('rn1lI');
    expect(indexed).toContain('The gate is opened.');
  });

  it('indexes the agent synthesis at its source-supported timestamps', () => {
    const segments = evidenceToSegments({
      durationMs: 90_000,
      video: { width: 1920, height: 1080, fps: 30 },
      transcript: [],
      visualObservations: [],
      tracks: [],
      knowledgeSummary: {
        overview: 'A source-supported overview.',
        participants: [
          {
            name: 'Participant A',
            role: 'speaker',
            evidence: [{ startMs: 35_000, endMs: 40_000 }],
          },
        ],
        stateHistory: [
          {
            startMs: 65_000,
            endMs: 70_000,
            state: 'The displayed state changed.',
            confidence: 'direct',
          },
        ],
        keyEvents: [],
        narrative: [
          {
            startMs: 32_000,
            endMs: 58_000,
            text: 'Participant A introduces the round, then the displayed state changes.',
            confidence: 'direct',
          },
        ],
        context: [],
        sourceItems: [
          {
            kind: 'question',
            channel: 'spoken',
            text: 'Which option is supported?',
            answer: 'Option B',
            startMs: 42_000,
            endMs: 46_000,
          },
          {
            kind: 'slide-item',
            channel: 'visible',
            text: 'First supported point',
            answer: '',
            startMs: 50_000,
            endMs: 55_000,
          },
        ],
        uncertainties: [],
      },
      answeringGuide: {
        importantEntities: [],
        questionsToPrepareFor: [],
        instruction: '',
      },
    });

    expect(segments.map((segment) => segment.visualContext).join('\n')).toContain(
      'Indexed participant: Participant A — speaker.',
    );
    expect(segments.map((segment) => segment.visualContext).join('\n')).toContain(
      'Indexed state (direct): The displayed state changed.',
    );
    expect(segments.map((segment) => segment.visualContext).join('\n')).toContain(
      'Participant A introduces the round, then the displayed state changes.',
    );
    expect(segments.find((segment) => segment.startSecs === 30)?.visualContext).toMatch(
      /^Participant A introduces the round/,
    );
    expect(segments.map((segment) => segment.visualContext).join('\n')).toContain(
      'Source question (spoken): Which option is supported?\nSource answer: Option B',
    );
    expect(segments.map((segment) => segment.visualContext).join('\n')).toContain(
      'Source item (slide-item, visible): First supported point',
    );
  });
});

describe('formatVideoKnowledgeSummary', () => {
  it('renders an audited clean timeline with source timestamps without another model pass', () => {
    const result = formatVideoKnowledgeSummary({
      durationMs: 3_900_000,
      video: { width: 1920, height: 1080, fps: 30 },
      transcript: [],
      visualObservations: [],
      tracks: [],
      knowledgeSummary: {
        overview: 'A source-supported account.',
        participants: [],
        stateHistory: [
          {
            startMs: 3_650_000,
            endMs: 3_670_000,
            state: 'The displayed state changes.',
            confidence: 'direct',
          },
        ],
        keyEvents: [
          {
            startMs: 95_000,
            endMs: 101_000,
            event: 'A key action is shown.',
            confidence: 'direct',
          },
        ],
        narrative: [
          {
            startMs: 90_000,
            endMs: 110_000,
            text: 'The named speaker introduces the topic before the first action.',
            confidence: 'direct',
          },
        ],
        context: [],
        uncertainties: ['One identity remains unverified.'],
      },
      answeringGuide: { importantEntities: [], questionsToPrepareFor: [], instruction: '' },
    });

    expect(result).toContain('[1:35–1:41] Event: A key action is shown.');
    expect(result).toContain(
      '[1:30–1:50] The named speaker introduces the topic before the first action.',
    );
    expect(result).toContain('[1:00:50–1:01:10] State: The displayed state changes.');
    expect(result).toContain('One identity remains unverified.');
  });
});

describe('video runtime model ownership', () => {
  const configuredModels = {
    audioProvider: 'deepgram',
    audioApiKey: 'audio-key',
    larkupAgentProvider: 'openai',
    larkupAgentApiKey: 'brain-key',
    larkupAgentModel: 'openai/gpt-5-mini',
    larkupVisionProvider: 'vercel_ai_gateway',
    larkupVisionApiKey: 'vision-key',
    larkupVisionModel: 'google/gemini-3.6-flash',
  };

  it('requires user-owned credentials for local and cloud runtimes', () => {
    expect(() => assertVideoIntelligenceConfiguration({ runtimeMode: 'local' })).toThrow(
      /vision provider and API key/,
    );
    expect(() => assertVideoIntelligenceConfiguration({ runtimeMode: 'managed-cloud' })).toThrow(
      /vision provider and API key/,
    );
    expect(() =>
      assertVideoIntelligenceConfiguration({ runtimeMode: 'managed-cloud', ...configuredModels }),
    ).not.toThrow();
  });

  it('uses DeepSeek as the agent brain while keeping vision on its own provider', () => {
    expect(
      resolveVideoJobModelConfiguration({
        audioProvider: 'deepgram',
        audioApiKey: 'audio-key',
        larkupAgentProvider: 'deepseek',
        larkupAgentApiKey: 'deepseek-key',
        larkupAgentModel: 'deepseek/deepseek-v4-pro',
        larkupVisionProvider: 'google',
        larkupVisionApiKey: 'google-key',
        larkupVisionModel: 'google/gemini-3.6-flash',
      }),
    ).toEqual({
      audio: { provider: 'deepgram', apiKey: 'audio-key', model: 'nova-3' },
      brain: {
        provider: 'deepseek',
        apiKey: 'deepseek-key',
        model: 'deepseek/deepseek-v4-pro',
      },
      vision: {
        provider: 'google',
        apiKey: 'google-key',
        model: 'google/gemini-3.6-flash',
      },
    });
  });

  it('forwards all three user-owned model selections to a managed Cloud worker', () => {
    expect(
      createVideoIntelligenceSubmitRequest({
        source: { uploadId: 'upload-1' },
        brief: { indexingMode: 'fast' },
        config: { runtimeMode: 'managed-cloud', ...configuredModels },
      }),
    ).toEqual({
      source: { uploadId: 'upload-1' },
      brief: { indexingMode: 'fast' },
      modelConfiguration: {
        audio: { provider: 'deepgram', apiKey: 'audio-key', model: 'nova-3' },
        brain: { provider: 'openai', apiKey: 'brain-key', model: 'openai/gpt-5-mini' },
        vision: {
          provider: 'vercel_ai_gateway',
          apiKey: 'vision-key',
          model: 'google/gemini-3.6-flash',
        },
      },
    });
  });

  it('keeps local job payloads credential-free because local settings are process-scoped', () => {
    expect(
      createVideoIntelligenceSubmitRequest({
        source: { uploadId: 'upload-1' },
        brief: { indexingMode: 'fast' },
        config: { runtimeMode: 'local', ...configuredModels },
      }),
    ).toEqual({ source: { uploadId: 'upload-1' }, brief: { indexingMode: 'fast' } });
  });

  it('requires semantic evidence from managed Cloud jobs, including older incomplete results', () => {
    expect(
      shouldRequireSemanticVideoEvidence({ runtimeMode: 'managed-cloud' }, undefined, []),
    ).toBe(true);
  });

  it('does not let a managed planner disable the visual evidence required by the host', () => {
    expect(
      enforceManagedSemanticBrief(
        { runtimeMode: 'managed-cloud' },
        { indexingMode: 'fast', requireSemanticVision: false },
      ),
    ).toEqual({ indexingMode: 'fast', requireSemanticVision: true });
    expect(
      enforceManagedSemanticBrief(
        { runtimeMode: 'local' },
        { indexingMode: 'fast', requireSemanticVision: false },
      ),
    ).toEqual({ indexingMode: 'fast', requireSemanticVision: false });
  });

  it('keeps a partial provider warning when the worker returned usable semantic evidence', () => {
    expect(
      shouldRequireSemanticVideoEvidence(
        { runtimeMode: 'managed-cloud' },
        { attempted: true, error: '73/77 clips returned evidence' },
        [
          {
            startMs: 0,
            endMs: 5_000,
            text: 'A source-grounded visual observation.',
            confidence: 0.9,
          },
        ],
      ),
    ).toBe(false);
  });

  it('accepts local OCR, detection, and speech evidence without cloud semantic captions', () => {
    expect(
      shouldRequireSemanticVideoEvidence(
        { runtimeMode: 'local' },
        { attempted: false, error: null },
        [],
      ),
    ).toBe(false);
  });

  it('keeps visual operators enabled for a local index by default', () => {
    expect(shouldSkipHeavyVideoOperators({ runtimeMode: 'local' })).toBe(false);
    expect(shouldSkipHeavyVideoOperators({ runtimeMode: 'managed-cloud' })).toBe(false);
    expect(
      shouldSkipHeavyVideoOperators({ runtimeMode: 'local' }, { skipHeavyOperators: true }),
    ).toBe(true);
  });

  it('leaves Fast Cloud modality choices to the agent unless explicitly overridden', () => {
    const asset = {
      toolInputs: { 'video-intelligence': { indexingMode: 'fast' } },
    } as unknown as MediaAsset;

    expect(shouldSkipCloudTranscription({ runtimeMode: 'managed-cloud' }, undefined, asset)).toBe(
      false,
    );
    expect(
      shouldSkipCloudTranscription(
        { runtimeMode: 'managed-cloud' },
        { indexingMode: 'balanced' },
        asset,
      ),
    ).toBe(false);
    expect(shouldSkipCloudVideoEmbeddings({ runtimeMode: 'managed-cloud' }, undefined, asset)).toBe(
      false,
    );
    expect(
      shouldSkipCloudVideoEmbeddings(
        { runtimeMode: 'managed-cloud' },
        { indexingMode: 'thorough' },
        asset,
      ),
    ).toBe(false);
    expect(
      shouldSkipCloudTranscription(
        { runtimeMode: 'managed-cloud' },
        { skipTranscription: true },
        asset,
      ),
    ).toBe(true);
  });
});

describe('managed cloud progress', () => {
  it('takes the runtime at its word for how far through a step it is', () => {
    expect(cloudOverallToStagePercent('detect', 40, 25)).toBe(25);
    expect(cloudOverallToStagePercent('synthesize', 60, 5)).toBe(5);
  });

  it('falls back to the overall percent for a runtime that does not report one', () => {
    expect(cloudOverallToStagePercent('detect', 40)).toBe(40);
    expect(cloudOverallToStagePercent('prepare', 10)).toBe(40);
  });

  it('never reports a step as finished', () => {
    expect(cloudOverallToStagePercent('detect', 100, 100)).toBe(99);
    expect(cloudOverallToStagePercent('prepare', 100)).toBe(99);
  });

  it('keeps synthesis moving from the runtime stage percent and exposes clip counters', () => {
    expect(
      cloudStageProgress({
        stage: 'synthesize',
        percent: 72,
        stagePercent: 31,
        message: 'Watching video segments (3/12 described · 2/12 indexed) · ~18 sec left',
      }),
    ).toEqual({ percent: 31, current: 3, total: 12, unit: 'captions' });
  });
});

describe('reconciled account as evidence', () => {
  const bundle: any = {
    durationMs: 600_000,
    video: { width: 1, height: 1, fps: 25 },
    transcript: [],
    visualObservations: [],
    tracks: [],
    entities: [],
    coverage: {
      requested: 'balanced',
      decodedFrames: 0,
      analyzedFrames: 0,
      heavyOperatorsDisabled: false,
    },
    answeringGuide: { importantEntities: [], questionsToPrepareFor: [], instruction: '' },
    knowledgeSummary: {
      overview: 'A committee session that reaches a decision.',
      participants: [
        { name: 'A. Rivera', role: 'chair', evidence: [{ startMs: 0, endMs: 5_000 }] },
      ],
      stateHistory: [
        { startMs: 10_000, endMs: 20_000, state: 'motion under discussion', confidence: 'direct' },
        { startMs: 500_000, endMs: 540_000, state: 'motion carried', confidence: 'direct' },
      ],
      keyEvents: [
        {
          startMs: 500_000,
          endMs: 505_000,
          event: 'the chair calls the vote',
          confidence: 'partial',
        },
      ],
      narrative: [
        {
          startMs: 480_000,
          endMs: 540_000,
          text: 'The chair moves from discussion to the vote, and the motion carries.',
          confidence: 'direct',
        },
      ],
      context: [{ fact: 'the session is recorded', evidence: [{ startMs: 0, endMs: 1_000 }] }],
      uncertainties: ['One speaker was not named.'],
    },
  };

  it('publishes what the index reconciled, so retrieval sees it too', () => {
    const inputs = evidenceToRefinementInputs(bundle);
    const reconciled = inputs.filter((input) => input.modality === 'computed');
    const texts = reconciled.map((input) => (input.payload as { text: string }).text);

    expect(texts).toContain('Reconciled state: motion carried');
    expect(texts).toContain('Reconciled event: the chair calls the vote');
    expect(texts).toContain('Reconciled participant: A. Rivera — chair');
    expect(texts).toContain(
      'Chronological note: The chair moves from discussion to the vote, and the motion carries.',
    );
    expect(texts.some((text) => text.startsWith('Reconciled overview:'))).toBe(true);
  });

  it('includes the reconciled account in the initial knowledge publication', () => {
    const texts = evidenceToKnowledgeInputs(bundle).reconciledEvidence.map(
      (input) => (input.payload as { text: string }).text,
    );

    expect(texts).toContain('Reconciled state: motion carried');
    expect(texts).toContain('Reconciled participant: A. Rivera — chair');
  });

  it('keeps each item on the span it was drawn from', () => {
    const inputs = evidenceToRefinementInputs(bundle);
    const carried = inputs.find(
      (input) => (input.payload as { text?: string }).text === 'Reconciled state: motion carried',
    );

    expect(carried?.timeRange).toMatchObject({ startSecs: 500, endSecs: 540 });
    // A reconciled claim carries the doubt the cross-check left open.
    expect(carried?.confidence.uncertaintyReasons).toContain('One speaker was not named.');
  });

  it('adds nothing when the runtime produced no reconciled account', () => {
    const { knowledgeSummary, ...withoutSummary } = bundle;
    expect(
      evidenceToRefinementInputs(withoutSummary as any).filter((i) => i.modality === 'computed'),
    ).toEqual([]);
  });
});
