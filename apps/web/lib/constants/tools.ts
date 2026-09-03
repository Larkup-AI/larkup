import { Search, Table, BarChart3, Code2, Files, FileEdit } from 'lucide-react';
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
  | 'signature'
  | 'image-analysis'
  | 'media';

export interface ChatToolBehavior {
  placement: ChatToolPlacement;
  pendingLabel?: string;
  resultView: ChatToolResultView;
  compactResult?: boolean;
}

export const CHAT_TOOL_BEHAVIORS: Record<string, ChatToolBehavior> = {
  searchKnowledgeBase: { placement: 'source', resultView: 'none' },
  // Renders through the generic output.ui.kind:'citations' contract
  // (message-item.tsx / chat-citations.tsx), same as any other tool --
  // nothing video-specific is hardcoded in the placement/resultView here.
  queryVideoKnowledge: {
    placement: 'inline',
    pendingLabel: 'Reviewing the video…',
    resultView: 'none',
  },
  queryVideoEvidence: {
    placement: 'inline',
    pendingLabel: 'Reviewing indexed video context…',
    resultView: 'none',
  },
  inspectVideoKnowledge: {
    placement: 'inline',
    pendingLabel: 'Checking the relevant moment…',
    resultView: 'none',
  },
  webSearch: { placement: 'web-search', resultView: 'none' },
  presentMedia: { placement: 'media', resultView: 'media' },
  queryTabularData: {
    placement: 'inline',
    pendingLabel: 'Checking data…',
    resultView: 'data-table',
    compactResult: true,
  },
  generateVisualization: {
    placement: 'visualization',
    pendingLabel: 'Preparing chart…',
    resultView: 'none',
  },
  executeAnalysis: {
    placement: 'inline',
    pendingLabel: 'Running analysis…',
    resultView: 'sandbox',
  },
  analyzeCorpusWithCode: {
    placement: 'inline',
    pendingLabel: 'Analyzing documents…',
    resultView: 'sandbox',
  },
  getIndexedData: {
    placement: 'inline',
    pendingLabel: 'Checking documents…',
    resultView: 'corpus',
  },
  analyzeImageDeeply: {
    placement: 'inline',
    pendingLabel: 'Analyzing image…',
    resultView: 'image-analysis',
  },
  fillDocumentForm: {
    placement: 'inline',
    pendingLabel: 'Updating document…',
    resultView: 'document-edit',
  },
  editDocument: {
    placement: 'inline',
    pendingLabel: 'Updating document…',
    resultView: 'document-edit',
  },
  requestDocumentSignature: {
    placement: 'inline',
    pendingLabel: 'Preparing signature…',
    resultView: 'signature',
  },
};

const FALLBACK_CHAT_TOOL_BEHAVIOR: ChatToolBehavior = {
  placement: 'inline',
  pendingLabel: 'Working…',
  resultView: 'none',
};

export function getChatToolBehavior(toolId: string): ChatToolBehavior {
  return CHAT_TOOL_BEHAVIORS[toolId] ?? FALLBACK_CHAT_TOOL_BEHAVIOR;
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
