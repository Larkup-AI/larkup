import { loadTool } from './tool-loader';

export interface ToolExtensionContext {
  config: Record<string, unknown>;
  fetch?: typeof globalThis.fetch;
  trackUsage?: (event: {
    meter: string;
    quantity: number;
    unit: string;
    metadata?: Record<string, unknown>;
  }) => void | Promise<void>;
}

/** Per-call data supplied by a host after the tool has been installed. */
export interface AgentToolExecutionContext {
  /** The host application's origin, for a tool-owned host API adapter when needed. */
  origin?: string;
  /** Isolates a tool action to the active project/workspace. */
  projectId?: string;
  /** Lets a long-running tool associate progress with the visible chat row. */
  toolCallId?: string;
  /**
   * Optional host-owned immutable media evidence access. Tools keep the
   * investigation policy; the host only supplies scoped data access.
   */
  mediaEvidence?: {
    getAsset: (mediaAssetId: string) => Promise<
      | {
          id: string;
          type: string;
          processingStatus?: string;
          durationSecs?: number;
          fileName?: string;
          originalUrl?: string;
        }
      | undefined
    >;
    planQuestion: (question: string) => {
      kinds: string[];
      requiresInspectionWhenInsufficient: boolean;
      requiresBothRanges?: boolean;
      requiresBroadCoverage?: boolean;
      /** Optional named subject resolved by the host's generic media planner. */
      subjectName?: string;
    };
    /**
     * Ranked windows worth looking at for this question, fused from every
     * timestamped retrieval signal the host holds (semantic evidence, clip
     * vectors). It reports agreement about *where*, never what is there, so a
     * tool still reads the evidence itself before making any claim. Optional:
     * a host without embeddings does not provide it.
     */
    locate?: (
      mediaAssetId: string,
      question: string,
      options?: { maxRanges?: number; maxWindowSecs?: number },
    ) => Promise<
      Array<{
        startSecs: number;
        endSecs: number;
        score: number;
        sources: string[];
        label?: string;
      }>
    >;
    planInvestigation?: (
      mediaAssetId: string,
      question: string,
    ) => Promise<
      | {
          candidateRanges: Array<{
            startSecs: number;
            endSecs: number;
            precision?: string;
            reason: string;
          }>;
          chapters?: Array<{
            title: string;
            summary: string;
            timeRange: { startSecs: number; endSecs: number; precision?: string };
          }>;
          scenes?: Array<{
            title: string;
            summary: string;
            timeRange: { startSecs: number; endSecs: number; precision?: string };
          }>;
          coverage?: {
            mode: 'focused' | 'broad';
            totalChapters: number;
            totalScenes: number;
            representedRanges: number;
          };
        }
      | undefined
    >;
    /**
     * Re-reads bounded windows of the original source to settle a question the
     * index cannot, and reports what that reading established.
     *
     * This is the interactive counterpart to dispatching a re-index: windows are
     * read together and the whole step is budgeted for a live turn, so a tool
     * can verify a claim inside a reply instead of leaving it unconfirmed.
     * Optional -- a host without source access or a vision capability omits it,
     * and a tool must still work when it is absent.
     */
    reWatch?: (
      mediaAssetId: string,
      question: string,
      ranges: Array<{ startSecs: number; endSecs: number; lookingFor?: string }>,
      options?: { maxWaitMs?: number; knownEntities?: string[] },
    ) => Promise<
      Array<{
        range: { startSecs: number; endSecs: number };
        at: string;
        found: string;
        read: string[];
        confidence: 'high' | 'medium' | 'low';
        /** True only when this reading actually settles the asked question. */
        settlesQuestion: boolean;
      }>
    >;
    search: (
      mediaAssetId: string,
      query: string,
      limit: number,
      options?: Record<string, unknown>,
    ) => Promise<
      Array<{
        evidence: {
          id: string;
          modality: string;
          timeRange: { startSecs: number; endSecs: number; precision?: string };
          /**
           * When this record entered the index, as an ISO timestamp. It lets a
           * tool tell evidence it just caused to be gathered from evidence that
           * was already there -- which is not something the payload can say.
           */
          createdAt: string;
          payload: unknown;
          source?: {
            kind: string;
            provider?: string;
            model?: string;
            version?: string;
          };
          confidence: unknown;
        };
      }>
    >;
  };
}

/** A client method invoked by an AgentToolDefinition. */
export type AgentToolHandler = (
  input: unknown,
  context: AgentToolExecutionContext,
) => unknown | Promise<unknown>;

export interface ToolExtension<TClient = unknown> {
  id: string;
  apiVersion: '1';
  createClient(context: ToolExtensionContext): TClient;
  /** Optionally prepares a declared runtime after the user has installed and selected it. */
  ensureRuntime?(context: ToolExtensionContext): Promise<void>;
  /** Restarts a user-managed runtime after credentials or other runtime settings change. */
  restartRuntime?(context: ToolExtensionContext): Promise<void>;
  /** Prepares a local runtime (e.g. pulls an image, syncs dependencies) without starting it. */
  installRuntime?(context: ToolExtensionContext): Promise<void>;
  /** Stops a running local runtime without uninstalling it. */
  stopRuntime?(context: ToolExtensionContext): Promise<void>;
  /** Verifies a tool-owned runtime or model configuration before it is saved. */
  verifyConfiguration?(context: ToolExtensionContext & { verifyKey?: string }): Promise<void>;
  /** Removes a local runtime's container/process and persisted runtime data after tool removal. */
  removeRuntime?(context: ToolExtensionContext): Promise<void>;
  /**
   * Optional, tool-defined host/environment report (e.g. Docker vs. native
   * availability, system suitability) for a settings UI to render before
   * installing a local runtime. Shape is entirely up to the tool — the host
   * only passes it through as JSON.
   */
  getHostCapabilities?(context: ToolExtensionContext): Promise<Record<string, unknown>>;
  /**
   * Optional runtime-specific provisioning. The host persists only `config`,
   * keeping tool names and credential formats out of host UI code.
   */
  provisionRuntime?(context: ToolExtensionContext): Promise<{
    config: Record<string, unknown>;
    display?: Record<string, string>;
  }>;
}

/** Defines the stable server-side boundary implemented by installable tools. */
export function defineToolExtension<TClient>(
  extension: ToolExtension<TClient>,
): ToolExtension<TClient> {
  return extension;
}

/** Loads and validates an installed tool extension without knowing its domain API. */
export async function loadToolExtension<TClient = unknown>(
  toolId: string,
): Promise<ToolExtension<TClient> | null> {
  const module = await loadTool<Record<string, unknown>>(toolId);
  if (!module) return null;
  const candidate = (module.TOOL_EXTENSION ?? module.default) as Partial<ToolExtension<TClient>>;
  if (
    !candidate ||
    candidate.id !== toolId ||
    candidate.apiVersion !== '1' ||
    typeof candidate.createClient !== 'function'
  ) {
    throw new Error(`Installed tool "${toolId}" does not expose a valid ToolExtension v1.`);
  }
  return candidate as ToolExtension<TClient>;
}

/**
 * One agent-callable action a tool exposes generically to any chat runtime.
 * A host reads this off the installed module — never hardcodes a tool's
 * name, schema, or behavior — and calls `client[method](input)` on the
 * client `ToolExtension.createClient()` already returned. A tool with
 * several distinct actions exports `AGENT_TOOLS: AgentToolDefinition[]`
 * instead of a single `AGENT_TOOL`.
 */
export interface AgentToolDefinition {
  /** Tool-call name shown to the model. Must be unique among a session's active tools. */
  name: string;
  description: string;
  /** JSON Schema (not a framework-specific schema type) for the call's input. */
  parameters: Record<string, unknown>;
  /** Method on the ToolExtension client this call invokes, e.g. `client[method](input)`. */
  method: string;
  /** Appended to the agent's system prompt once this tool is installed and authorized. */
  systemPromptFragment?: string;
  /**
   * Optional host-generic workflow role. This is intentionally about the
   * action, not a tool id, so a replacement Marketplace tool can provide the
   * same capability without changes to the chat route.
   */
  workflow?: 'evidence-refinement' | 'evidence-query';
  /** Source handle accepted by an evidence-query capability. */
  evidenceInput?: 'media-asset';
}

export function defineAgentTool(definition: AgentToolDefinition): AgentToolDefinition {
  return definition;
}
