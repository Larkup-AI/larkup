/**
 * Contract fixtures for the local dashboard.
 *
 * ALL VALUES ARE ILLUSTRATIVE MOCK DATA, not measured benchmark results. They
 * exist only so the UI can be built and reviewed against the v1 contract while
 * the benchmark agent implements the real controller. They deliberately use
 * generic placeholder source/question IDs and never encode any dataset's gold
 * answers, evidence, or question text.
 *
 * Covered run states (contract acceptance criteria): running, pausing, paused,
 * quota-blocked, mixed-route, partial-results, negative-pilot, completed. The
 * `offline` state is a backend MODE applied over these snapshots (readonly +
 * stale label), handled in the controller, not a separate run.
 */
import type {
  AccuracyMetric,
  ConfigProfile,
  ControllerEvent,
  Cost,
  DurationGroup,
  Issue,
  PairedMetric,
  ProviderScope,
  ProviderUsageMetric,
  ResultObject,
  RunMetrics,
  RunSnapshot,
  TaskObject,
  TimingMetric,
} from '../contract.js';

const T0 = '2026-11-14T12:00:00Z';

const VARIANTS = {
  gemini: 'gemini-native',
  qwen: 'qwen-video',
  twelve: 'twelvelabs-analyze',
  larkup: 'larkup-tool',
} as const;

function cost(
  actual: string | null,
  estimated: string | null,
  unknown = 0,
  reconciled = false,
): Cost {
  return { currency: 'USD', actual, estimated, unknownAttemptCount: unknown, reconciled };
}

function issue(
  code: string,
  message: string,
  retryable: boolean,
  nextEligibleAt: string | null = null,
  scopeId: string | null = null,
): Issue {
  return { code, scopeId, message, retryable, nextEligibleAt };
}

// ----------------------------------------------------------------------------
// Shared provider scopes (balances/quota/cooldown/route health, sanitized).
// ----------------------------------------------------------------------------
export const PROVIDER_SCOPES: ProviderScope[] = [
  {
    id: 'scope-gemini-paid',
    provider: 'gemini',
    accountAlias: 'gemini-paid-a',
    capabilities: ['video', 'image', 'tools'],
    balance: '14.00',
    balanceCurrency: 'USD',
    balanceReason: null,
    freeAllowanceRemaining: null,
    freeAllowanceUnit: null,
    quotaState: 'ok',
    cooldownUntil: null,
    routeHealth: 'healthy',
    tier: 'paid',
  },
  {
    id: 'scope-gemini-free',
    provider: 'gemini',
    accountAlias: 'gemini-free-c',
    capabilities: ['video', 'image'],
    balance: null,
    balanceCurrency: null,
    balanceReason: 'free tier exposes no cash balance',
    freeAllowanceRemaining: '0',
    freeAllowanceUnit: 'requests/day',
    quotaState: 'waiting_quota',
    cooldownUntil: '2026-11-15T00:00:00Z',
    routeHealth: 'healthy',
    tier: 'free',
  },
  {
    id: 'scope-twelve',
    provider: 'twelvelabs',
    accountAlias: 'twelve-acct-2',
    capabilities: ['index', 'analyze'],
    balance: null,
    balanceCurrency: null,
    balanceReason: 'allowance measured in processing hours, not cash',
    freeAllowanceRemaining: '9.2',
    freeAllowanceUnit: 'processing-hours',
    quotaState: 'ok',
    cooldownUntil: null,
    routeHealth: 'healthy',
    tier: 'legacy-allowance',
  },
  {
    id: 'scope-qwen',
    provider: 'qwen',
    accountAlias: 'qwen-direct',
    capabilities: ['video', 'image'],
    balance: '7.50',
    balanceCurrency: 'USD',
    balanceReason: null,
    freeAllowanceRemaining: null,
    freeAllowanceUnit: null,
    quotaState: 'ok',
    cooldownUntil: null,
    routeHealth: 'degraded',
    tier: 'direct',
  },
  {
    id: 'scope-gateway',
    provider: 'vercel-gateway',
    accountAlias: 'gateway-a',
    capabilities: ['video', 'image', 'text'],
    balance: '14.80',
    balanceCurrency: 'USD',
    balanceReason: null,
    freeAllowanceRemaining: null,
    freeAllowanceUnit: null,
    quotaState: 'ok',
    cooldownUntil: null,
    routeHealth: 'healthy',
    tier: 'gateway',
  },
  {
    id: 'scope-runpod',
    provider: 'runpod',
    accountAlias: 'runpod-pod-1',
    capabilities: ['gpu-compute', 'storage'],
    balance: '12.63',
    balanceCurrency: 'USD',
    balanceReason: null,
    freeAllowanceRemaining: null,
    freeAllowanceUnit: null,
    quotaState: 'ok',
    cooldownUntil: null,
    routeHealth: 'healthy',
    tier: 'rental',
  },
];

export const CONFIG_PROFILES: ConfigProfile[] = [
  {
    revision: 'config-03',
    active: true,
    routingPolicy: 'direct-first-then-gateway-fallback',
    roles: {
      audio: {
        logicalModel: 'asr-default',
        resolvedModel: 'deepgram-nova',
        routeId: 'route-deepgram-1',
      },
      brain: {
        logicalModel: 'planner-cheap',
        resolvedModel: 'deepseek-chat',
        routeId: 'route-deepseek',
      },
      index_vision: {
        logicalModel: 'index-vl',
        resolvedModel: 'gemini-flash',
        routeId: 'route-gemini-paid-a',
      },
      refinement_vision: {
        logicalModel: 'refine-vl',
        resolvedModel: 'qwen-vl',
        routeId: 'route-qwen-direct',
      },
      answer: {
        logicalModel: 'answer-fixed',
        resolvedModel: 'gemini-flash',
        routeId: 'route-gemini-paid-a',
      },
    },
  },
];

// ----------------------------------------------------------------------------
// Builders for per-run task / result / metric sets.
// ----------------------------------------------------------------------------
const SOURCES: Array<{ id: string; dataset: string; group: DurationGroup; ms: number }> = [
  { id: 'src-short-01', dataset: 'video-mme', group: 'short', ms: 95_000 },
  { id: 'src-short-02', dataset: 'video-mme', group: 'short', ms: 110_000 },
  { id: 'src-med-01', dataset: 'video-mme', group: 'medium', ms: 640_000 },
  { id: 'src-med-02', dataset: 'longvideobench', group: 'medium', ms: 820_000 },
  { id: 'src-long-01', dataset: 'longvideobench', group: 'long', ms: 2_400_000 },
  { id: 'src-long-02', dataset: 'video-mme', group: 'long', ms: 3_300_000 },
];

function emptyUsage() {
  return {
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    cachedTokens: null,
    processingSeconds: null,
    freeAllowanceConsumed: null,
  };
}

function nullTiming(reason: string) {
  return {
    queueMs: null,
    prepareMs: null,
    uploadMs: null,
    indexMs: null,
    answerMs: null,
    firstTokenMs: null,
    endToEndMs: null,
    inputReuse: null,
    measurementProfileId: null,
    unavailableReasons: { endToEndMs: reason },
  };
}

type RunFixture = {
  snapshot: RunSnapshot;
  tasks: TaskObject[];
  results: ResultObject[];
  metrics: RunMetrics;
  events: ControllerEvent[];
};

// --- RUNNING (mixed-route: gemini direct + gateway fallback, qwen degraded, free-tier waiting_quota)
const running: RunFixture = {
  snapshot: {
    id: 'run-pilot-running',
    revision: '12',
    phase: 'pilot',
    state: 'running',
    decision: 'not_evaluated',
    protocolRevision: 'protocol-pilot-v1',
    datasetManifestId: 'manifest-pilot-v1',
    configRevision: 'config-03',
    startedAt: T0,
    updatedAt: '2026-11-14T12:08:00Z',
    taskCounts: { completed: 9, running: 2, submitted: 1, waiting_quota: 2, pending: 10 },
    coverage: {
      plannedQuestions: 24,
      plannedVariants: 4,
      completedPairs: 9,
      sharedCompletedQuestions: 2,
    },
    cost: cost('0.42', '0.71', 1, false),
    blockers: [],
    eventCursor: '48',
  },
  tasks: [
    {
      taskId: 'task-g-short01',
      runId: 'run-pilot-running',
      sourceId: 'src-short-01',
      dataset: 'video-mme',
      questionId: 'q-short-01-a',
      variantId: VARIANTS.gemini,
      provider: 'gemini',
      accountAlias: 'gemini-paid-a',
      routeId: 'route-gemini-paid-a',
      role: 'answer',
      durationGroup: 'short',
      state: 'running',
      stage: 'generating',
      percent: 60,
      attempts: [
        {
          attemptId: 'a1',
          state: 'running',
          stage: 'generating',
          percent: 60,
          startedAt: '2026-11-14T12:07:40Z',
          issue: null,
        },
      ],
      issue: null,
      updatedAt: '2026-11-14T12:08:00Z',
    },
    {
      taskId: 'task-g-med02',
      runId: 'run-pilot-running',
      sourceId: 'src-med-02',
      dataset: 'longvideobench',
      questionId: 'q-med-02-a',
      variantId: VARIANTS.gemini,
      provider: 'vercel-gateway',
      accountAlias: 'gateway-a',
      routeId: 'route-gateway-gemini',
      role: 'answer',
      durationGroup: 'medium',
      state: 'submitted',
      stage: 'queued-remote',
      percent: null,
      attempts: [
        {
          attemptId: 'a1',
          state: 'failed',
          stage: 'direct-429',
          percent: null,
          startedAt: '2026-11-14T12:05:10Z',
          issue: issue(
            'QUOTA_WAIT',
            'Direct account rate limited; routed to gateway fallback.',
            true,
            '2026-11-14T12:20:00Z',
            'scope-gemini-paid',
          ),
        },
        {
          attemptId: 'a2',
          state: 'submitted',
          stage: 'queued-remote',
          percent: null,
          startedAt: '2026-11-14T12:06:00Z',
          issue: null,
        },
      ],
      issue: null,
      updatedAt: '2026-11-14T12:07:55Z',
    },
    {
      taskId: 'task-tw-long01',
      runId: 'run-pilot-running',
      sourceId: 'src-long-01',
      dataset: 'longvideobench',
      questionId: null,
      variantId: VARIANTS.twelve,
      provider: 'twelvelabs',
      accountAlias: 'twelve-acct-2',
      routeId: 'route-twelve-2',
      role: 'index_vision',
      durationGroup: 'long',
      state: 'running',
      stage: 'indexing',
      percent: null, // indeterminate percent -> indeterminate bar in UI
      attempts: [
        {
          attemptId: 'a1',
          state: 'running',
          stage: 'indexing',
          percent: null,
          startedAt: '2026-11-14T12:02:00Z',
          issue: null,
        },
      ],
      issue: null,
      updatedAt: '2026-11-14T12:08:00Z',
    },
    {
      taskId: 'task-qw-short02',
      runId: 'run-pilot-running',
      sourceId: 'src-short-02',
      dataset: 'video-mme',
      questionId: 'q-short-02-a',
      variantId: VARIANTS.qwen,
      provider: 'qwen',
      accountAlias: 'qwen-direct',
      routeId: 'route-qwen-direct',
      role: 'answer',
      durationGroup: 'short',
      state: 'waiting_quota',
      stage: null,
      percent: null,
      attempts: [
        {
          attemptId: 'a1',
          state: 'waiting_quota',
          stage: null,
          percent: null,
          startedAt: null,
          issue: issue(
            'QUOTA_WAIT',
            'Qwen route degraded; waiting for capacity.',
            true,
            '2026-11-14T12:15:00Z',
            'scope-qwen',
          ),
        },
      ],
      issue: issue(
        'QUOTA_WAIT',
        'Qwen route degraded; waiting for capacity.',
        true,
        '2026-11-14T12:15:00Z',
        'scope-qwen',
      ),
      updatedAt: '2026-11-14T12:07:30Z',
    },
    {
      taskId: 'task-lk-med01',
      runId: 'run-pilot-running',
      sourceId: 'src-med-01',
      dataset: 'video-mme',
      questionId: 'q-med-01-a',
      variantId: VARIANTS.larkup,
      provider: 'larkup-tool',
      accountAlias: 'runpod-pod-1',
      routeId: 'route-larkup-local',
      role: 'index_vision',
      durationGroup: 'medium',
      state: 'completed',
      stage: 'done',
      percent: 100,
      attempts: [
        {
          attemptId: 'a1',
          state: 'completed',
          stage: 'done',
          percent: 100,
          startedAt: '2026-11-14T12:01:00Z',
          issue: null,
        },
      ],
      issue: null,
      updatedAt: '2026-11-14T12:04:00Z',
    },
    {
      taskId: 'task-gfree-short01',
      runId: 'run-pilot-running',
      sourceId: 'src-short-01',
      dataset: 'video-mme',
      questionId: 'q-short-01-b',
      variantId: VARIANTS.gemini,
      provider: 'gemini',
      accountAlias: 'gemini-free-c',
      routeId: 'route-gemini-free-c',
      role: 'answer',
      durationGroup: 'short',
      state: 'waiting_quota',
      stage: null,
      percent: null,
      attempts: [
        {
          attemptId: 'a1',
          state: 'waiting_quota',
          stage: null,
          percent: null,
          startedAt: null,
          issue: issue(
            'QUOTA_WAIT',
            'Free daily quota reached; resets at provider reset zone.',
            true,
            '2026-11-15T00:00:00Z',
            'scope-gemini-free',
          ),
        },
      ],
      issue: issue(
        'QUOTA_WAIT',
        'Free daily quota reached; resets at provider reset zone.',
        true,
        '2026-11-15T00:00:00Z',
        'scope-gemini-free',
      ),
      updatedAt: '2026-11-14T12:06:10Z',
    },
  ],
  results: [
    buildResult(
      'run-pilot-running',
      'src-short-01',
      'video-mme',
      'q-short-01-a',
      VARIANTS.larkup,
      'short',
      95_000,
      true,
      'larkup-tool',
      'runpod-pod-1',
      'route-larkup-local',
      'rental',
    ),
    buildResult(
      'run-pilot-running',
      'src-short-01',
      'video-mme',
      'q-short-01-a',
      VARIANTS.gemini,
      'short',
      95_000,
      true,
      'gemini',
      'gemini-paid-a',
      'route-gemini-paid-a',
      'paid',
    ),
    buildResult(
      'run-pilot-running',
      'src-med-01',
      'video-mme',
      'q-med-01-a',
      VARIANTS.larkup,
      'medium',
      640_000,
      false,
      'larkup-tool',
      'runpod-pod-1',
      'route-larkup-local',
      'rental',
    ),
  ],
  metrics: buildMetrics('run-pilot-running', 'config-03', false, {
    [VARIANTS.larkup]: { short: [2, 2, 2], medium: [0, 1, 1], long: [0, 0, 2] },
    [VARIANTS.gemini]: { short: [1, 1, 2], medium: [0, 0, 1], long: [0, 0, 1] },
  }),
  events: [
    ev('44', 'task.updated', 'run-pilot-running', '2026-11-14T12:06:10Z', '11', {
      taskId: 'task-gfree-short01',
      state: 'waiting_quota',
    }),
    ev('45', 'route.changed', 'run-pilot-running', '2026-11-14T12:06:00Z', '11', {
      taskId: 'task-g-med02',
      from: 'route-gemini-paid-a',
      to: 'route-gateway-gemini',
      reason: 'direct-429',
    }),
    ev('46', 'usage.updated', 'run-pilot-running', '2026-11-14T12:07:00Z', '12', {
      actual: '0.42',
      estimated: '0.71',
      unknownAttemptCount: 1,
    }),
    ev('47', 'task.updated', 'run-pilot-running', '2026-11-14T12:07:40Z', '12', {
      taskId: 'task-g-short01',
      state: 'running',
    }),
    ev('48', 'quota.updated', 'run-pilot-running', '2026-11-14T12:08:00Z', '12', {
      scopeId: 'scope-qwen',
      quotaState: 'waiting_quota',
    }),
  ],
};

// --- PAUSING (draining in-flight work)
const pausing: RunFixture = cloneState(running, {
  id: 'run-pilot-pausing',
  state: 'pausing',
  revision: '13',
  updatedAt: '2026-11-14T12:09:00Z',
  note: 'Pause requested; draining in-flight requests. No new dispatch.',
});

// --- PAUSED
const paused: RunFixture = cloneState(running, {
  id: 'run-pilot-paused',
  state: 'paused',
  revision: '14',
  updatedAt: '2026-11-14T12:10:00Z',
  note: 'Paused. Resume eligible tasks without duplicating completed work.',
});

// --- BLOCKED (quota-blocked: all remaining work waiting on quota/credit)
const blocked: RunFixture = {
  ...cloneState(running, {
    id: 'run-pilot-blocked',
    state: 'blocked',
    revision: '20',
    updatedAt: '2026-11-14T13:00:00Z',
  }),
};
blocked.snapshot.taskCounts = { completed: 9, waiting_quota: 6, blocked: 2, pending: 7 };
blocked.snapshot.blockers = [
  issue(
    'QUOTA_WAIT',
    'Gemini free daily quota reached across free accounts.',
    true,
    '2026-11-15T00:00:00Z',
    'scope-gemini-free',
  ),
  issue(
    'CREDIT_EXHAUSTED',
    'Qwen direct balance exhausted; no funded fallback for this exact model.',
    false,
    null,
    'scope-qwen',
  ),
];
blocked.snapshot.cost = cost('0.63', '0.63', 0, true);

// --- PARTIAL (some core cells blocked; completed others; partial metrics, missingness disclosed)
const partial: RunFixture = completedBase('run-pilot-partial', 'blocked', '31');
partial.snapshot.taskCounts = { completed: 18, blocked: 4, skipped: 2 };
partial.snapshot.decision = 'inconclusive';
partial.snapshot.coverage = {
  plannedQuestions: 24,
  plannedVariants: 4,
  completedPairs: 18,
  sharedCompletedQuestions: 6,
};
partial.snapshot.blockers = [
  issue(
    'SOURCE_UNAVAILABLE',
    'Two long sources became unavailable; replacements pending from reserve list.',
    true,
    null,
    null,
  ),
  issue(
    'CREDIT_EXHAUSTED',
    'TwelveLabs processing-hours allowance insufficient for remaining long sources.',
    false,
    null,
    'scope-twelve',
  ),
];
partial.metrics = buildMetrics('run-pilot-partial', 'config-03', true, {
  [VARIANTS.larkup]: { short: [5, 6, 6], medium: [4, 5, 6], long: [1, 2, 6] },
  [VARIANTS.gemini]: { short: [4, 5, 6], medium: [3, 4, 6], long: [0, 0, 6] },
  [VARIANTS.twelve]: { short: [3, 4, 6], medium: [2, 3, 6], long: [0, 0, 6] },
});

// --- NEGATIVE PILOT (completed, decision = stop)
const negative: RunFixture = completedBase('run-pilot-negative', 'completed', '40');
negative.snapshot.decision = 'stop';
negative.snapshot.taskCounts = { completed: 24 };
negative.metrics = buildMetrics('run-pilot-negative', 'config-03', false, {
  [VARIANTS.larkup]: { short: [4, 6, 6], medium: [3, 6, 6], long: [2, 6, 6] },
  [VARIANTS.gemini]: { short: [5, 6, 6], medium: [5, 6, 6], long: [4, 6, 6] },
  [VARIANTS.twelve]: { short: [4, 6, 6], medium: [4, 6, 6], long: [3, 6, 6] },
});

// --- COMPLETED (decision = continue)
const completed: RunFixture = completedBase('run-pilot-completed', 'completed', '52');
completed.snapshot.decision = 'continue';
completed.snapshot.taskCounts = { completed: 24 };
completed.metrics = buildMetrics('run-pilot-completed', 'config-03', false, {
  [VARIANTS.larkup]: { short: [6, 6, 6], medium: [5, 6, 6], long: [5, 6, 6] },
  [VARIANTS.gemini]: { short: [5, 6, 6], medium: [4, 6, 6], long: [3, 6, 6] },
  [VARIANTS.twelve]: { short: [4, 6, 6], medium: [4, 6, 6], long: [2, 6, 6] },
});

// --- DRAFT (start is demonstrable from here)
const draft: RunFixture = {
  snapshot: {
    id: 'run-pilot-draft',
    revision: '1',
    phase: 'pilot',
    state: 'draft',
    decision: 'not_evaluated',
    protocolRevision: 'protocol-pilot-v1',
    datasetManifestId: 'manifest-pilot-v1',
    configRevision: 'config-03',
    startedAt: null,
    updatedAt: '2026-11-14T11:55:00Z',
    taskCounts: { pending: 24 },
    coverage: {
      plannedQuestions: 24,
      plannedVariants: 4,
      completedPairs: 0,
      sharedCompletedQuestions: 0,
    },
    cost: cost(null, '0.70', 0, false),
    blockers: [],
    eventCursor: '0',
  },
  tasks: [],
  results: [],
  metrics: buildMetrics('run-pilot-draft', 'config-03', false, {}),
  events: [],
};

export const RUN_FIXTURES: Record<string, RunFixture> = {
  [draft.snapshot.id]: draft,
  [running.snapshot.id]: running,
  [pausing.snapshot.id]: pausing,
  [paused.snapshot.id]: paused,
  [blocked.snapshot.id]: blocked,
  [partial.snapshot.id]: partial,
  [negative.snapshot.id]: negative,
  [completed.snapshot.id]: completed,
};

export const RUN_ORDER = [
  draft.snapshot.id,
  completed.snapshot.id,
  negative.snapshot.id,
  partial.snapshot.id,
  blocked.snapshot.id,
  paused.snapshot.id,
  pausing.snapshot.id,
  running.snapshot.id,
];

/** The run whose last export is served as the readonly snapshot in offline mode. */
export const OFFLINE_SNAPSHOT_RUN_ID = completed.snapshot.id;
export const OFFLINE_LAST_SYNCED_AT = '2026-11-14T13:12:00Z';

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function buildResult(
  runId: string,
  sourceId: string,
  dataset: string,
  questionId: string,
  variantId: string,
  durationGroup: DurationGroup,
  sourceDurationMs: number,
  correct: boolean | null,
  provider: string,
  accountAlias: string,
  routeId: string,
  tier: string,
): ResultObject {
  const native = provider !== 'larkup-tool';
  return {
    runId,
    sourceId,
    dataset,
    questionId,
    variantId,
    attemptId: `${questionId}-${variantId}`,
    configRevision: 'config-03',
    durationGroup,
    sourceDurationMs,
    logicalModel: 'answer-fixed',
    resolvedModel: provider === 'gemini' ? 'gemini-flash' : provider,
    routeId,
    provider,
    accountAlias,
    tier,
    state: 'completed',
    answer: correct === null ? null : 'B',
    predictedOption: correct === null ? null : 'B',
    correct,
    evaluationRevision: 'eval-v1',
    evidence:
      correct === null
        ? []
        : [
            {
              sourceId,
              startMs: 12_000,
              endMs: 18_500,
              kind: 'visual',
              supportedClaim: 'on-screen detail used to answer',
            },
          ],
    cost: cost(native ? '0.03' : '0.00', '0.03', 0, true),
    timing: native
      ? {
          queueMs: 400,
          prepareMs: null,
          uploadMs: 2_100,
          indexMs: null,
          answerMs: 5_200,
          firstTokenMs: 900,
          endToEndMs: 7_700,
          inputReuse: false,
          measurementProfileId: 'mp-1',
          unavailableReasons: { indexMs: 'native service has no persistent index stage' },
        }
      : {
          queueMs: 250,
          prepareMs: 1_800,
          uploadMs: 1_200,
          indexMs: 32_000,
          answerMs: 3_400,
          firstTokenMs: 700,
          endToEndMs: 38_600,
          inputReuse: true,
          measurementProfileId: 'mp-1',
        },
    usage: {
      ...emptyUsage(),
      inputTokens: 1_240,
      outputTokens: 18,
      processingSeconds: native ? 7 : 39,
      freeAllowanceConsumed: null,
    },
    issue: null,
  };
}

type GroupCounts = {
  short: [number, number, number];
  medium: [number, number, number];
  long: [number, number, number];
};
// Each group tuple is [correctCount, completedCount, plannedCount].

function buildMetrics(
  runId: string,
  configRevision: string,
  partial: boolean,
  byVariant: Record<string, GroupCounts>,
): RunMetrics {
  const accuracy: AccuracyMetric[] = [];
  const groups: DurationGroup[] = ['short', 'medium', 'long'];
  for (const [variantId, gc] of Object.entries(byVariant)) {
    let allCorrect = 0,
      allCompleted = 0,
      allPlanned = 0;
    for (const g of groups) {
      const [correctCount, completedCount, plannedCount] = gc[g];
      accuracy.push({
        cohortId: `cohort-${g}`,
        variantId,
        durationGroup: g,
        denominator: completedCount,
        completedCount,
        plannedCount,
        correctCount,
        blockedCount: plannedCount - completedCount,
        accuracy: completedCount === 0 ? null : round(correctCount / completedCount),
      });
      allCorrect += correctCount;
      allCompleted += completedCount;
      allPlanned += plannedCount;
    }
    accuracy.push({
      cohortId: 'cohort-all',
      variantId,
      durationGroup: 'all',
      denominator: allCompleted,
      completedCount: allCompleted,
      plannedCount: allPlanned,
      correctCount: allCorrect,
      blockedCount: allPlanned - allCompleted,
      accuracy: allCompleted === 0 ? null : round(allCorrect / allCompleted),
    });
  }

  const variantIds = Object.keys(byVariant);
  const paired: PairedMetric[] = [];
  if (variantIds.includes(VARIANTS.larkup) && variantIds.includes(VARIANTS.gemini)) {
    const shared = Math.min(
      sumCompleted(byVariant[VARIANTS.larkup]),
      sumCompleted(byVariant[VARIANTS.gemini]),
    );
    const lkCorrect = sumCorrect(byVariant[VARIANTS.larkup]);
    const gmCorrect = sumCorrect(byVariant[VARIANTS.gemini]);
    const wins = Math.max(0, Math.round((lkCorrect - gmCorrect) * 0.6) + 3);
    const losses = Math.max(0, Math.round((gmCorrect - lkCorrect) * 0.6) + 2);
    paired.push({
      cohortId: 'cohort-shared',
      variantA: VARIANTS.larkup,
      variantB: VARIANTS.gemini,
      comparedSourceCount: Math.ceil(shared / 3),
      wins,
      losses,
      ties: Math.max(0, shared - wins - losses),
      denominator: shared,
    });
  }

  const timing: TimingMetric[] = [
    {
      cohortId: 'cohort-all',
      variantId: VARIANTS.larkup,
      stage: 'index',
      p50Ms: 31_000,
      p95Ms: 46_000,
      sampleCount: 6,
      nullReason: null,
    },
    {
      cohortId: 'cohort-all',
      variantId: VARIANTS.larkup,
      stage: 'answer',
      p50Ms: 3_300,
      p95Ms: 5_900,
      sampleCount: 18,
      nullReason: null,
    },
    {
      cohortId: 'cohort-all',
      variantId: VARIANTS.larkup,
      stage: 'firstToken',
      p50Ms: 700,
      p95Ms: 1_300,
      sampleCount: 18,
      nullReason: null,
    },
    {
      cohortId: 'cohort-all',
      variantId: VARIANTS.gemini,
      stage: 'index',
      p50Ms: null,
      p95Ms: null,
      sampleCount: 0,
      nullReason: 'native service has no persistent index stage',
    },
    {
      cohortId: 'cohort-all',
      variantId: VARIANTS.gemini,
      stage: 'answer',
      p50Ms: 5_200,
      p95Ms: 9_100,
      sampleCount: 17,
      nullReason: null,
    },
    {
      cohortId: 'cohort-all',
      variantId: VARIANTS.gemini,
      stage: 'firstToken',
      p50Ms: 900,
      p95Ms: 1_800,
      sampleCount: 17,
      nullReason: null,
    },
  ];

  const providerUsage: ProviderUsageMetric[] = [
    {
      provider: 'gemini',
      accountAlias: 'gemini-paid-a',
      cashSpent: '0.21',
      freeAllowanceConsumed: null,
      listPriceEquivalent: '0.21',
      currency: 'USD',
    },
    {
      provider: 'gemini',
      accountAlias: 'gemini-free-c',
      cashSpent: '0.00',
      freeAllowanceConsumed: '42 requests',
      listPriceEquivalent: '0.09',
      currency: 'USD',
    },
    {
      provider: 'twelvelabs',
      accountAlias: 'twelve-acct-2',
      cashSpent: '0.00',
      freeAllowanceConsumed: '0.8 processing-hours',
      listPriceEquivalent: '0.00',
      currency: 'USD',
    },
    {
      provider: 'qwen',
      accountAlias: 'qwen-direct',
      cashSpent: '0.06',
      freeAllowanceConsumed: null,
      listPriceEquivalent: '0.06',
      currency: 'USD',
    },
    {
      provider: 'runpod',
      accountAlias: 'runpod-pod-1',
      cashSpent: '0.15',
      freeAllowanceConsumed: null,
      listPriceEquivalent: '0.15',
      currency: 'USD',
    },
  ];

  const totalCompleted = Object.values(byVariant).reduce((s, gc) => s + sumCompleted(gc), 0);
  const totalPlanned = Object.values(byVariant).reduce((s, gc) => s + sumPlanned(gc), 0);

  return {
    runId,
    configRevision,
    evaluationRevision: 'eval-v1',
    accuracy,
    paired,
    timing,
    providerUsage,
    coverage: {
      plannedQuestions: Math.round(totalPlanned / Object.keys(byVariant).length),
      plannedVariants: Object.keys(byVariant).length,
      completedPairs: totalCompleted,
      sharedCompletedQuestions: Math.min(...Object.values(byVariant).map(sumCompleted)),
    },
    cost: cost('0.42', '0.71', partial ? 2 : 0, !partial),
    partial,
  };
}

function sumCorrect(gc: GroupCounts) {
  return gc.short[0] + gc.medium[0] + gc.long[0];
}
function sumCompleted(gc: GroupCounts) {
  return gc.short[1] + gc.medium[1] + gc.long[1];
}
function sumPlanned(gc: GroupCounts) {
  return gc.short[2] + gc.medium[2] + gc.long[2];
}
function round(n: number) {
  return Math.round(n * 1000) / 1000;
}

function ev(
  id: string,
  type: ControllerEvent['type'],
  runId: string,
  occurredAt: string,
  revision: string,
  data: Record<string, unknown>,
): ControllerEvent {
  return { id, type, runId, occurredAt, revision, data };
}

function cloneState(
  base: RunFixture,
  patch: {
    id: string;
    state: RunSnapshot['state'];
    revision: string;
    updatedAt: string;
    note?: string;
  },
): RunFixture {
  const snapshot: RunSnapshot = {
    ...structuredClone(base.snapshot),
    id: patch.id,
    state: patch.state,
    revision: patch.revision,
    updatedAt: patch.updatedAt,
  };
  const retarget = <T extends { runId?: string }>(arr: T[]): T[] =>
    structuredClone(arr).map((x) => (x.runId ? { ...x, runId: patch.id } : x));
  return {
    snapshot,
    tasks: retarget(base.tasks).map((t) => ({ ...t, runId: patch.id })),
    results: retarget(base.results),
    metrics: { ...structuredClone(base.metrics), runId: patch.id },
    events: structuredClone(base.events).map((e) => ({ ...e, runId: patch.id })),
  };
}

function completedBase(id: string, state: RunSnapshot['state'], revision: string): RunFixture {
  const snapshot: RunSnapshot = {
    id,
    revision,
    phase: 'pilot',
    state,
    decision: 'not_evaluated',
    protocolRevision: 'protocol-pilot-v1',
    datasetManifestId: 'manifest-pilot-v1',
    configRevision: 'config-03',
    startedAt: T0,
    updatedAt: '2026-11-14T13:00:00Z',
    taskCounts: { completed: 24 },
    coverage: {
      plannedQuestions: 24,
      plannedVariants: 4,
      completedPairs: 24,
      sharedCompletedQuestions: 18,
    },
    cost: cost('0.63', '0.63', 0, true),
    blockers: [],
    eventCursor: '60',
  };
  const results: ResultObject[] = [
    buildResult(
      id,
      'src-short-01',
      'video-mme',
      'q-short-01-a',
      VARIANTS.larkup,
      'short',
      95_000,
      true,
      'larkup-tool',
      'runpod-pod-1',
      'route-larkup-local',
      'rental',
    ),
    buildResult(
      id,
      'src-short-01',
      'video-mme',
      'q-short-01-a',
      VARIANTS.gemini,
      'short',
      95_000,
      true,
      'gemini',
      'gemini-paid-a',
      'route-gemini-paid-a',
      'paid',
    ),
    buildResult(
      id,
      'src-long-02',
      'video-mme',
      'q-long-02-a',
      VARIANTS.larkup,
      'long',
      3_300_000,
      true,
      'larkup-tool',
      'runpod-pod-1',
      'route-larkup-local',
      'rental',
    ),
    buildResult(
      id,
      'src-long-02',
      'video-mme',
      'q-long-02-a',
      VARIANTS.gemini,
      'long',
      3_300_000,
      false,
      'gemini',
      'gemini-paid-a',
      'route-gemini-paid-a',
      'paid',
    ),
  ];
  return {
    snapshot,
    tasks: [],
    results,
    metrics: buildMetrics(id, 'config-03', false, {}),
    events: [
      ev('60', 'export.ready', id, '2026-11-14T13:00:00Z', revision, {
        exportId: 'exp-1',
        checksum: 'sha256:placeholder',
      }),
    ],
  };
}
