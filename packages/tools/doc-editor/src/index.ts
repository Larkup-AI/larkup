/**
 * @larkup/tool-doc-editor
 *
 * Document Editor / Form Filling tool for the Larkup platform.
 * Enables AI-powered form filling and document editing in a Canvas-style UI.
 *
 * Supports: PDF, DOCX, PPTX, TXT
 *
 * Uses:
 * - pdf-lib (MIT) for native PDF form field operations
 * - mammoth (MIT) for DOCX reading
 * - @larkup/sandbox for heavy editing (python-docx, python-pptx, pypdf)
 */

export const TOOL_META = {
  id: 'doc-editor',
  name: 'Document Editor',
  version: '0.1.0',
} as const;

// Public API
export {
  createSession,
  getSession,
  getAllSessions,
  deleteSession,
  applyFieldEdits,
  applyContentEdits,
  exportDocument,
} from './editor';

export {
  parseDocument,
  parsePDF,
  parseDOCX,
  parsePPTX,
  parseTXT,
  detectDocumentType,
  enrichPDFWithText,
} from './parsers';

export type {
  DocumentType,
  DocumentField,
  DocumentPage,
  ParsedDocument,
  FieldEdit,
  ContentEdit,
  EditorSession,
  EditResult,
} from './types';
