import {
  Search,
  Table,
  BarChart3,
  Code2,
  Files,
  FileEdit,
  FileDown,
  FileText,
  Film,
  Globe,
  PenLine,
  Component,
  Image as ImageIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type Tool = {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  plugin?: boolean;
};

/**
 * Chat-facing behavior for every first-party tool. Keep tool progress copy and
 * presentation decisions here so adding a tool does not require scattered
 * name checks throughout the chat UI.
 */
export type ChatToolPlacement = 'source' | 'web-search' | 'visualization' | 'media' | 'inline';

export type ChatToolResultView =
  | 'none'
  | 'data-table'
  | 'sandbox'
  | 'corpus'
  | 'document-edit'
  | 'file-export'
  | 'signature'
  | 'image-analysis'
  | 'media';

export interface ChatToolBehavior {
  placement: ChatToolPlacement;
  pendingLabel?: string;
  /**
   * Ordered "thinking" lines shown one at a time while the tool runs, fading
   * from one to the next (NotebookLM/ChatGPT style). Each entry narrates a real
   * stage of this skill's work, so the wait reads as progress rather than a
   * single frozen label. The first entry doubles as `pendingLabel` when that is
   * omitted; keep the sequence short (2–4 calm, sentence-case lines).
   */
  pendingSteps?: string[];
  /**
   * The glyph shown beside the thinking steps while this skill runs, so each
   * kind of work reads at a glance (a magnifier for search, a chart for
   * visualization, …). Defaults to a neutral `Component` mark.
   */
  icon?: LucideIcon;
  resultView: ChatToolResultView;
  compactResult?: boolean;
  /** Keep quick operations moving without implying a measurable percentage. */
  showProgressBar?: boolean;
}

export const CHAT_TOOL_BEHAVIORS: Record<string, ChatToolBehavior> = {
  searchKnowledgeBase: {
    placement: 'source',
    pendingSteps: ['Searching your sources…', 'Reading the matches…', 'Gathering the context…'],
    icon: Search,
    resultView: 'none',
  },
  inspectPdfPages: {
    placement: 'source',
    pendingLabel: 'Checking PDF pages…',
    pendingSteps: ['Opening the PDF…', 'Checking the pages…'],
    icon: FileText,
    resultView: 'none',
  },
  analyzePdfPages: {
    placement: 'source',
    pendingLabel: 'Reading PDF pages…',
    pendingSteps: ['Opening the PDF…', 'Reading the pages…', 'Pulling out the details…'],
    icon: FileText,
    resultView: 'none',
  },
  // Renders through the generic output.ui.kind:'citations' contract
  // (message-item.tsx / chat-citations.tsx), same as any other tool --
  // nothing video-specific is hardcoded in the placement/resultView here.
  queryVideoKnowledge: {
    placement: 'inline',
    pendingLabel: 'Reviewing the video…',
    pendingSteps: ['Opening the video…', 'Reviewing the footage…', 'Finding the moment…'],
    icon: Film,
    resultView: 'none',
  },
  queryVideoEvidence: {
    placement: 'inline',
    pendingLabel: 'Reviewing indexed video context…',
    pendingSteps: ['Scanning indexed video…', 'Matching the evidence…', 'Lining up the moments…'],
    icon: Film,
    // Generic structured rows are rendered through ChatDataTable. Ordinary
    // evidence results have no rows and remain citation/answer driven.
    resultView: 'data-table',
    compactResult: false,
  },
  inspectVideoKnowledge: {
    placement: 'inline',
    pendingLabel: 'Checking the relevant moment…',
    pendingSteps: ['Jumping to the moment…', 'Checking the detail…'],
    icon: Film,
    resultView: 'none',
  },
  webSearch: {
    placement: 'web-search',
    pendingSteps: ['Searching the web…', 'Reading the results…', 'Pulling it together…'],
    icon: Globe,
    resultView: 'none',
  },
  presentMedia: { placement: 'media', resultView: 'media' },
  queryTabularData: {
    placement: 'inline',
    pendingLabel: 'Checking data…',
    pendingSteps: ['Reading your data…', 'Filtering the rows…', 'Aggregating the numbers…'],
    icon: Table,
    resultView: 'data-table',
    compactResult: true,
    showProgressBar: false,
  },
  generateVisualization: {
    placement: 'visualization',
    pendingLabel: 'Preparing chart…',
    pendingSteps: ['Shaping the data…', 'Drawing the chart…'],
    icon: BarChart3,
    resultView: 'none',
  },
  createDataExport: {
    placement: 'inline',
    pendingLabel: 'Preparing file…',
    pendingSteps: ['Gathering the results…', 'Building your file…'],
    icon: FileDown,
    resultView: 'file-export',
    showProgressBar: false,
  },
  executeAnalysis: {
    placement: 'inline',
    pendingLabel: 'Running analysis…',
    pendingSteps: [
      'Analyzing your request…',
      'Running the analysis…',
      'Working through the numbers…',
      'Putting the results together…',
    ],
    icon: Code2,
    resultView: 'sandbox',
  },
  analyzeCorpusWithCode: {
    placement: 'inline',
    pendingLabel: 'Analyzing documents…',
    pendingSteps: [
      'Reading across your documents…',
      'Running the analysis…',
      'Summarizing what it found…',
    ],
    icon: Code2,
    resultView: 'sandbox',
  },
  getIndexedData: {
    placement: 'inline',
    pendingLabel: 'Checking documents…',
    pendingSteps: ['Listing your documents…', 'Filtering the set…'],
    icon: Files,
    resultView: 'corpus',
  },
  analyzeImageDeeply: {
    placement: 'inline',
    pendingLabel: 'Analyzing image…',
    pendingSteps: ['Opening the image…', 'Looking closely…', 'Describing what it shows…'],
    icon: ImageIcon,
    resultView: 'image-analysis',
  },
  fillDocumentForm: {
    placement: 'inline',
    pendingLabel: 'Updating document…',
    pendingSteps: ['Reading the document…', 'Filling in the fields…'],
    icon: FileEdit,
    resultView: 'document-edit',
  },
  editDocument: {
    placement: 'inline',
    pendingLabel: 'Updating document…',
    pendingSteps: ['Reading the document…', 'Making the edits…'],
    icon: FileEdit,
    resultView: 'document-edit',
  },
  requestDocumentSignature: {
    placement: 'inline',
    pendingLabel: 'Preparing signature…',
    pendingSteps: ['Preparing the document…', 'Marking the signature spots…'],
    icon: PenLine,
    resultView: 'signature',
  },
};

/**
 * Fallback "thinking" lines for the assistant's work before (or between) any
 * tool call -- the reasoning gap NotebookLM fills with rotating status copy.
 * A stable module-level array so the indicator's cycle is not reset by a new
 * reference on every render.
 */
export const GENERIC_THINKING_STEPS: readonly string[] = [
  'Thinking…',
  'Working through your request…',
  'Putting the answer together…',
];

/** Neutral glyph for the assistant's own reasoning, before any tool is chosen. */
export const GENERIC_THINKING_ICON: LucideIcon = Component;

const FALLBACK_CHAT_TOOL_BEHAVIOR: ChatToolBehavior = {
  placement: 'inline',
  pendingLabel: 'Working…',
  resultView: 'none',
};

export function getChatToolBehavior(toolId: string): ChatToolBehavior {
  return CHAT_TOOL_BEHAVIORS[toolId] ?? FALLBACK_CHAT_TOOL_BEHAVIOR;
}

/**
 * The ordered "thinking" lines to narrate while a tool runs. Prefers the
 * tool's explicit `pendingSteps`, falls back to its single `pendingLabel`, and
 * finally to a neutral default -- so every skill, including ones added later,
 * always has at least one calm status line.
 */
export function getPendingSteps(toolId: string): string[] {
  const behavior = getChatToolBehavior(toolId);
  if (behavior.pendingSteps && behavior.pendingSteps.length > 0) return behavior.pendingSteps;
  if (behavior.pendingLabel) return [behavior.pendingLabel];
  return ['Working…'];
}

/** The glyph to show while a tool runs; falls back to the neutral mark. */
export function getPendingIcon(toolId: string): LucideIcon {
  return getChatToolBehavior(toolId).icon ?? GENERIC_THINKING_ICON;
}

export const BUILT_IN_TOOLS: Tool[] = [
  {
    id: 'searchKnowledgeBase',
    name: 'Semantic Search',
    description: 'Search the RAG knowledge base for text.',
    icon: Search,
  },
  {
    id: 'queryTabularData',
    name: 'Tabular Data Query',
    description: 'Filter, group, and aggregate tabular data.',
    icon: Table,
  },
  {
    id: 'generateVisualization',
    name: 'Generate Charts',
    description: 'Create interactive charts from Assistant results.',
    icon: BarChart3,
  },
  {
    id: 'createDataExport',
    name: 'Export Answer',
    description: 'Create a downloadable Excel, CSV, or PDF file from an Assistant result.',
    icon: FileDown,
  },
  {
    id: 'executeAnalysis',
    name: 'Python Sandbox',
    description: 'Execute Python code for complex analysis.',
    icon: Code2,
  },
  {
    id: 'getIndexedData',
    name: 'Indexed Data',
    description: 'List and filter source documents.',
    icon: Files,
  },
  {
    id: 'analyzeCorpusWithCode',
    name: 'Corpus Analysis',
    description: 'Run code against the full indexed corpus.',
    icon: Code2,
  },
  {
    id: 'fillDocumentForm',
    name: 'Form Filler',
    description: 'Fill forms in the active document.',
    icon: FileEdit,
  },
];
