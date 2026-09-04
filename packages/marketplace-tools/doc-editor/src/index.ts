/**
 * @larkup/tool-doc-editor
 *
 * Document Editor / Form Filling tool for the Larkup platform.
 * Enables AI-powered form filling and document editing in a Canvas-style UI.
 *
 */

export const TOOL_META = {
  id: 'doc-editor',
  name: 'Document Editor',
  version: '0.1.0',
} as const;

export const TOOL_EXTENSION = {
  id: 'doc-editor',
  apiVersion: '1',
  createClient: () => ({}),
};

// Public API
export {
  createSession,
  getSession,
  getAllSessions,
  deleteSession,
  restoreSession,
  applyFieldEdits,
  applyContentEdits,
  applySignature,
  exportDocument,
} from './editor.js';

export {
  parseDocument,
  parsePDF,
  parseDOCX,
  parsePPTX,
  parseTXT,
  detectDocumentType,
  enrichPDFWithText,
} from './parsers.js';

export type {
  DocumentType,
  DocumentField,
  DocumentPage,
  ParsedDocument,
  FieldEdit,
  ContentEdit,
  EditorSession,
  EditResult,
} from './types.js';
