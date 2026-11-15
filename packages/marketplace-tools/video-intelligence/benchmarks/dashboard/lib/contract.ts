/**
 * TypeScript mirror of the Video benchmark controller API v1 contract
 * (benchmarks/data/dashboard-api-v1.md). This is the single source of truth
 * the UI and the mock controller share so neither side redefines status,
 * units or cost semantics. Keep it in lockstep with the versioned contract;
 * coordinate any change with the benchmark agent via a versioned diff.
 *
 * Units (from the contract):
 *  - timestamps: ISO-8601 UTC strings
 *  - durations: milliseconds (number)
 *  - source positions: milliseconds from original source start
 *  - monetary amounts: decimal STRINGS (never binary floats); currency explicit
 *  - unknown values: null WITH a reason, never silently coerced to 0
 */

export const API_VERSION = 'v1';

export type RunState =
  | 'draft'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'blocked'
  | 'cancelling'
  | 'cancelled'
  | 'completed'
  | 'failed';

export type TaskState =
  | 'pending'
  | 'ready'
  | 'leased'
  | 'submitted'
  | 'running'
  | 'waiting_quota'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped';

export type Decision = 'not_evaluated' | 'continue' | 'stop' | 'inconclusive';
export type Phase = 'smoke' | 'pilot' | 'publication' | 'ablation';
export type Role = 'audio' | 'brain' | 'index_vision' | 'refinement_vision' | 'answer';

export type Cost = {
  currency: string;
  /** Reconciled actual cash, decimal string, or null when still unknown. */
  actual: string | null;
  /** Estimated cash, decimal string, or null. Not additive with `actual`. */
  estimated: string | null;
  unknownAttemptCount: number;
  reconciled: boolean;
};

export type Issue = {
  code: string;
  scopeId: string | null;
  /** Sanitized: no raw provider payload / secret URL. */
  message: string;
  retryable: boolean;
  nextEligibleAt: string | null;
};

export type TaskCounts = Partial<Record<TaskState, number>>;

export type Coverage = {
  plannedQuestions: number;
  plannedVariants: number;
  completedPairs: number;
  sharedCompletedQuestions: number;
};

export type RunSnapshot = {
  id: string;
  revision: string;
  phase: Phase;
  state: RunState;
  decision: Decision;
  protocolRevision: string;
  datasetManifestId: string;
  configRevision: string;
  startedAt: string | null;
  updatedAt: string;
  /** Sparse: absent states mean zero. */
  taskCounts: TaskCounts;
  coverage: Coverage;
  cost: Cost;
  blockers: Issue[];
  eventCursor: string;
};

export type RunSummary = {
  id: string;
  phase: Phase;
  state: RunState;
  decision: Decision;
  updatedAt: string;
  datasetManifestId: string;
  /** Short human label for the run list (not part of scoring). */
  label?: string;
};

export type DurationGroup = 'short' | 'medium' | 'long';

export type Timing = {
  queueMs: number | null;
  prepareMs: number | null;
  uploadMs: number | null;
  indexMs: number | null;
  answerMs: number | null;
  firstTokenMs: number | null;
  endToEndMs: number | null;
  inputReuse: boolean | null;
  coldFirstAnswerMs?: number | null;
  measurementProfileId: string | null;
  /** Per-field unavailable reasons keyed by timing field name. */
  unavailableReasons?: Partial<Record<keyof Omit<Timing, 'unavailableReasons'>, string>>;
};

export type Usage = {
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cachedTokens: number | null;
  processingSeconds: number | null;
  /** Free-allowance consumption, kept separate from paid cash. */
  freeAllowanceConsumed: string | null;
};

export type EvidenceEntry = {
  sourceId: string;
  /** Original-clock positions, ms from source start. */
  startMs: number;
  endMs: number;
  kind: 'transcript' | 'visual' | 'ocr' | 'subtitle' | 'other';
  /** Supported-claim text where safe; never a filesystem path or raw media URL. */
  supportedClaim: string | null;
};

export type ResultObject = {
  runId: string;
  sourceId: string;
  dataset: string;
  questionId: string;
  variantId: string;
  attemptId: string | null;
  configRevision: string | null;
  durationGroup: DurationGroup;
  sourceDurationMs: number;
  logicalModel: string | null;
  resolvedModel: string | null;
  routeId: string | null;
  provider: string | null;
  system?: BenchmarkSystem;
  accountAlias: string | null;
  tier: string | null;
  state: TaskState;
  answer: string | null;
  predictedOption: string | null;
  /** boolean | null — null means not evaluated / blocked; never render as 0. */
  correct: boolean | null;
  evaluationRevision: string | null;
  evidence: EvidenceEntry[];
  cost: Cost;
  taskCost?: Cost;
  timing: Timing;
  usage: Usage;
  issue: Issue | null;
};

export type TaskAttempt = {
  attemptId: string;
  state: TaskState;
  /** Raw provider stage/percent where known; null => indeterminate. */
  stage: string | null;
  percent: number | null;
  startedAt: string | null;
  issue: Issue | null;
};

export type TaskObject = {
  taskId: string;
  runId: string;
  sourceId: string;
  dataset: string;
  questionId: string | null;
  variantId: string;
  provider: string | null;
  system?: BenchmarkSystem;
  progress?: unknown;
  progressObservedAt?: string;
  accountAlias: string | null;
  routeId: string | null;
  role: Role | null;
  durationGroup: DurationGroup;
  state: TaskState;
  /** Raw provider stage/percent where known; null => indeterminate. */
  stage: string | null;
  percent: number | null;
  attempts: TaskAttempt[];
  issue: Issue | null;
  updatedAt: string;
};

export type AccuracyMetric = {
  cohortId: string;
  variantId: string;
  durationGroup: DurationGroup | 'all';
  /** correct / denominator. denominator is REQUIRED; value w/o it is invalid. */
  denominator: number;
  completedCount: number;
  plannedCount: number;
  correctCount: number;
  blockedCount: number;
  /** null when no completed answers — never coerce to 0. */
  accuracy: number | null;
};

export type PairedMetric = {
  cohortId: string;
  variantA: string;
  variantB: string;
  /** Completed source cohort the pair is computed over. */
  comparedSourceCount: number;
  wins: number;
  losses: number;
  ties: number;
  denominator: number;
};

export type TimingMetric = {
  cohortId: string;
  variantId: string;
  stage: 'index' | 'answer' | 'firstToken' | 'endToEnd' | 'queue' | 'coldFirstAnswer';
  /** Null with reason for native services without this stage. */
  p50Ms: number | null;
  p95Ms: number | null;
  sampleCount: number;
  nullReason: string | null;
};

export type ProviderUsageMetric = {
  provider: string;
  accountAlias: string;
  /** Paid cash spent on this scope (decimal string). */
  cashSpent: string | null;
  /** Free allowance consumed, kept separate from cash. */
  freeAllowanceConsumed: string | null;
  /** List-price-equivalent reference, never folded into cash. */
  listPriceEquivalent: string | null;
  currency: string;
};

export type RunMetrics = {
  runId: string;
  configRevision: string;
  evaluationRevision: string | null;
  accuracy: AccuracyMetric[];
  summary?: VariantSummary[];
  plannedCount?: number;
  paired: PairedMetric[];
  timing: TimingMetric[];
  providerUsage: ProviderUsageMetric[];
  coverage: Coverage;
  cost: Cost;
  /** True when some declared core cells are blocked (partial result). */
  partial: boolean;
};

export type ProviderScope = {
  id: string;
  provider: string;
  accountAlias: string;
  capabilities: string[];
  /** Balance observation; null with reason when unknown (never 0 or unlimited). */
  balance: string | null;
  balanceCurrency: string | null;
  balanceReason: string | null;
  /** Free allowance remaining, if the provider exposes one. */
  freeAllowanceRemaining: string | null;
  freeAllowanceUnit: string | null;
  quotaState: 'ok' | 'waiting_quota' | 'exhausted' | 'unknown';
  cooldownUntil: string | null;
  routeHealth: 'healthy' | 'degraded' | 'down' | 'unknown';
  tier: string;
};

export type ConfigProfile = {
  revision: string;
  active: boolean;
  routingPolicy: string;
  /** Sanitized profile fields only; NEVER env values or key material. */
  roles: Partial<Record<Role, { logicalModel: string; resolvedModel: string; routeId: string }>>;
};

export type ControllerEvent = {
  id: string;
  type:
    | 'run.updated'
    | 'task.updated'
    | 'attempt.completed'
    | 'usage.updated'
    | 'quota.updated'
    | 'route.changed'
    | 'config.activated'
    | 'evaluation.updated'
    | 'export.ready'
    | 'issue.raised';
  runId: string;
  occurredAt: string;
  revision: string;
  data: Record<string, unknown>;
};

export type EventPage = {
  events: ControllerEvent[];
  nextCursor: string;
  hasMore: boolean;
};

export type Health = {
  apiVersion: string;
  controllerBuild: string;
  schemaVersion: string;
  availability: 'available' | 'degraded' | 'offline';
  serverTime: string;
  /** Dashboard-local augmentation: which backend mode produced this response. */
  mode?: BackendMode;
  /** For offline mode: when the readonly snapshot was last synced. */
  lastSyncedAt?: string | null;
};

export type Cursored<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type ApiError = {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    nextEligibleAt: string | null;
    requestId: string;
  };
};

export type BackendMode = 'mock' | 'proxy' | 'offline';

/** Domain error codes defined by the contract. */
export const DOMAIN_CODES = [
  'QUOTA_WAIT',
  'CREDIT_EXHAUSTED',
  'AUTH_INVALID',
  'MODEL_UNAVAILABLE',
  'CAPABILITY_UNSUPPORTED',
  'REMOTE_OUTCOME_UNKNOWN',
  'CONFIG_INVALID',
  'SOURCE_UNAVAILABLE',
  'EVALUATION_INVALID',
  'INFRA_FAILURE',
] as const;

/** Terminal run states where control buttons should be disabled. */
export const TERMINAL_RUN_STATES: RunState[] = ['cancelled', 'completed', 'failed'];

export function isTerminal(state: RunState): boolean {
  return TERMINAL_RUN_STATES.includes(state);
}

export type BenchmarkSystem =
  'larkup' | 'retrieval' | 'gemini' | 'qwen' | 'twelvelabs' | 'muse' | 'minimax';
export type VariantSummary = {
  variantId: string;
  logicalModel?: string;
  system: BenchmarkSystem;
  plannedCount: number;
  completedCount: number;
  correctCount: number;
  incorrectCount: number;
  blockedCount: number;
  stateCounts: Record<string, number>;
  accuracy: {
    value: number | null;
    denominator: number;
    plannedCount: number;
    completedCount: number;
  };
  cost: Cost;
  preparationCost: Cost;
  questionCost: Cost;
};
export type JsonRow = Record<string, unknown>;
export type DatabasePage = {
  items: JsonRow[];
  columns?: string[];
  nextCursor: string | null;
  hasMore: boolean;
  readonly?: boolean;
};
export type OperatorOperation = {
  id: string;
  action: string;
  state: string;
  stage?: string;
  cancellable?: boolean;
  startup?: {
    phase: 'waiting_capacity' | 'starting_gpu' | 'ready';
    attempt: number;
    nextRetryAt: string | null;
    retrySeconds?: number;
    stage: string;
  };
  issue?: Issue;
  warning?: string;
  result?: { runId?: string; state?: string };
};
export type SystemStatus = {
  selectedRunId?: string | null;
  readiness?: {
    checkedAt: string;
    checks: {
      system: BenchmarkSystem;
      route: string;
      model?: string;
      state: string;
      completedAnswers: number;
      note: string;
    }[];
    limitations: string[];
  } | null;
  revision: string;
  readonly: boolean;
  controllerAvailable: boolean;
  pod: { state: string; observedAt: string | null };
  supervisor: { mode: string };
  services: JsonRow[];
  operations: OperatorOperation[];
};
export type LogPage = {
  service: string;
  lines: { id: string; text: string }[];
  nextCursor: string;
  hasMore: boolean;
  available: boolean;
  reset?: boolean;
  reason?: string;
  snapshot?: boolean;
};
