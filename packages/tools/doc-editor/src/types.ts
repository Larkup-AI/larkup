/* ------------------------------------------------------------------ */
/* Types for the Document Editor / Form Filling tool                   */
/* ------------------------------------------------------------------ */

/** Supported document types */
export type DocumentType = 'pdf' | 'docx' | 'pptx' | 'txt' | 'xlsx';

/** A single editable field detected in a document */
export interface DocumentField {
  /** Unique field identifier within the document */
  id: string;
  /** Human-readable field name / label */
  name: string;
  /** Field type */
  type: 'text' | 'textarea' | 'checkbox' | 'radio' | 'date' | 'number' | 'select';
  /** Current value (empty if unfilled) */
  value: string;
  /** Page/slide index (0-based) */
  pageIndex: number;
  /** Whether the field is required (if detectable) */
  required?: boolean;
  /** Placeholder or tooltip text */
  placeholder?: string;
  /** Options for select/radio fields */
  options?: string[];
  /** Bounding box for overlay positioning (PDF) — percentages of page */
  bbox?: { x: number; y: number; width: number; height: number };
}

/** A single page or slide of a parsed document */
export interface DocumentPage {
  /** 0-based page/slide index */
  index: number;
  /** Extracted text content */
  text: string;
  /** HTML rendering (for DOCX via mammoth) */
  html?: string;
  /** Fields on this page */
  fields: DocumentField[];
  /** Page dimensions in points (PDF) */
  dimensions?: { width: number; height: number };
}

/** Result of parsing a document */
export interface ParsedDocument {
  /** Session ID for tracking edits */
  sessionId: string;
  /** Original filename */
  fileName: string;
  /** Detected document type */
  type: DocumentType;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  fileSize: number;
  /** Pages/slides */
  pages: DocumentPage[];
  /** All fields across all pages (flat) */
  fields: DocumentField[];
  /** Full raw text extraction */
  rawText: string;
  /** Document metadata (author, title, dates, etc.) */
  metadata: Record<string, string>;
  /** Total page/slide count */
  totalPages: number;
}

/** An edit operation to apply to a document */
export interface FieldEdit {
  /** Field ID to update */
  fieldId: string;
  /** New value */
  value: string;
  /** Type of edit */
  type: 'fill' | 'replace' | 'append' | 'clear';
}

/** A content-level edit (not field-based) */
export interface ContentEdit {
  /** Page/slide index */
  pageIndex: number;
  /** Type of content edit */
  type: 'replace_text' | 'insert_text' | 'delete_text';
  /** Search text (for replace) */
  search?: string;
  /** Replacement or insertion text */
  text: string;
  /** Position for insert (paragraph index) */
  position?: number;
}

/** Active editing session */
export interface EditorSession {
  /** Unique session ID */
  id: string;
  /** Original filename */
  fileName: string;
  /** Document type */
  type: DocumentType;
  /** MIME type */
  mimeType: string;
  /** Original file as base64 */
  originalFileBase64: string;
  /** Current (modified) file as base64 */
  currentFileBase64: string;
  /** Parsed document state */
  parsed: ParsedDocument;
  /** Applied edits history */
  edits: FieldEdit[];
  /** Created timestamp */
  createdAt: string;
  /** Last modified timestamp */
  updatedAt: string;
}

/** Result of applying edits */
export interface EditResult {
  /** Whether the edit succeeded */
  success: boolean;
  /** Updated parsed document */
  parsed: ParsedDocument;
  /** Updated file as base64 */
  fileBase64: string;
  /** Error message if failed */
  error?: string;
  /** Fields that were updated */
  updatedFields: string[];
}
