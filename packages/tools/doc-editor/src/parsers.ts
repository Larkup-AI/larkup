/**
 * Document parsers for PDF, DOCX, PPTX, and TXT files.
 *
 * Uses lightweight MIT-licensed packages:
 * - pdf-lib: PDF form field reading/filling (MIT)
 * - mammoth: DOCX → HTML + text extraction (MIT, already in web app)
 * - Sandbox python-pptx: PPTX parsing/editing
 * - Native: TXT passthrough
 */

import { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup } from 'pdf-lib';
import mammoth from 'mammoth';
import { randomUUID } from 'node:crypto';
import type { DocumentType, DocumentField, DocumentPage, ParsedDocument } from './types.js';

/* ------------------------------------------------------------------ */
/* Detect document type from MIME / extension                          */
/* ------------------------------------------------------------------ */

const MIME_MAP: Record<string, DocumentType> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

const EXT_MAP: Record<string, DocumentType> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.pptx': 'pptx',
  '.txt': 'txt',
  '.xlsx': 'xlsx',
};

export function detectDocumentType(fileName: string, mimeType?: string): DocumentType | null {
  if (mimeType && MIME_MAP[mimeType]) return MIME_MAP[mimeType];
  const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
  return EXT_MAP[ext] ?? null;
}

/* ------------------------------------------------------------------ */
/* PDF Parser — using pdf-lib (MIT)                                    */
/* ------------------------------------------------------------------ */

export async function parsePDF(buffer: Buffer, fileName: string): Promise<ParsedDocument> {
  const sessionId = randomUUID();
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });

  const pageCount = pdfDoc.getPageCount();
  const fields: DocumentField[] = [];
  const pages: DocumentPage[] = [];

  // Extract form fields (AcroForm)
  const form = pdfDoc.getForm();
  const formFields = form.getFields();

  for (const field of formFields) {
    const name = field.getName();
    const widgets = field.acroField.getWidgets();
    let pageIndex = 0;
    let bbox: DocumentField['bbox'] | undefined;

    // Try to determine which page the field is on
    if (widgets.length > 0) {
      const widget = widgets[0];
      const rect = widget.getRectangle();
      for (let i = 0; i < pageCount; i++) {
        const page = pdfDoc.getPage(i);
        const annots = page.node.lookupMaybe(
          page.node.get(page.node.normalizedEntries().Annots as any) as any,
          // @ts-expect-error — accessing internal for page detection
          page.node.context.lookupMaybe,
        );
        // Simplified page detection — place on page 0 if uncertain
        pageIndex = 0;
      }

      if (rect) {
        const page = pdfDoc.getPage(pageIndex);
        const { width: pw, height: ph } = page.getSize();
        bbox = {
          x: (rect.x / pw) * 100,
          y: (1 - (rect.y + rect.height) / ph) * 100,
          width: (rect.width / pw) * 100,
          height: (rect.height / ph) * 100,
        };
      }
    }

    let fieldType: DocumentField['type'] = 'text';
    let value = '';
    let options: string[] | undefined;

    if (field instanceof PDFTextField) {
      fieldType = field.isMultiline() ? 'textarea' : 'text';
      value = field.getText() ?? '';
    } else if (field instanceof PDFCheckBox) {
      fieldType = 'checkbox';
      value = field.isChecked() ? 'true' : 'false';
    } else if (field instanceof PDFDropdown) {
      fieldType = 'select';
      const selected = field.getSelected();
      value = selected.length > 0 ? selected[0] : '';
      options = field.getOptions();
    } else if (field instanceof PDFRadioGroup) {
      fieldType = 'radio';
      value = field.getSelected() ?? '';
      options = field.getOptions();
    }

    fields.push({
      id: `pdf_field_${fields.length}`,
      name,
      type: fieldType,
      value,
      pageIndex,
      bbox,
      options,
    });
  }

  // Extract text per page (basic extraction from PDF operators)
  // pdf-lib doesn't have built-in text extraction, so we use the raw text
  // For rich text extraction, the sandbox pypdf is used
  for (let i = 0; i < pageCount; i++) {
    const page = pdfDoc.getPage(i);
    const { width, height } = page.getSize();
    const pageFields = fields.filter((f) => f.pageIndex === i);

    pages.push({
      index: i,
      text: '', // Will be populated by sandbox if needed
      fields: pageFields,
      dimensions: { width, height },
    });
  }

  // Get metadata
  const metadata: Record<string, string> = {};
  const title = pdfDoc.getTitle();
  const author = pdfDoc.getAuthor();
  const subject = pdfDoc.getSubject();
  const creator = pdfDoc.getCreator();

  if (title) metadata['title'] = title;
  if (author) metadata['author'] = author;
  if (subject) metadata['subject'] = subject;
  if (creator) metadata['creator'] = creator;

  return {
    sessionId,
    fileName,
    type: 'pdf',
    mimeType: 'application/pdf',
    fileSize: buffer.length,
    pages,
    fields,
    rawText: '', // Populated separately via pdf-parse or sandbox
    metadata,
    totalPages: pageCount,
  };
}

/**
 * Extract raw text from PDF using pdf-parse (already available in web app).
 * This is called separately since pdf-parse is in the web app, not this package.
 */
export function enrichPDFWithText(parsed: ParsedDocument, extractedText: string): ParsedDocument {
  // Split text by page breaks (pdf-parse uses \n\n\n between pages typically)
  const pageTexts = extractedText.split(/\n{3,}/);

  const updatedPages = parsed.pages.map((page, i) => ({
    ...page,
    text: pageTexts[i]?.trim() ?? '',
  }));

  return {
    ...parsed,
    pages: updatedPages,
    rawText: extractedText,
  };
}

/* ------------------------------------------------------------------ */
/* DOCX Parser — using mammoth (MIT)                                   */
/* ------------------------------------------------------------------ */

export async function parseDOCX(buffer: Buffer, fileName: string): Promise<ParsedDocument> {
  const sessionId = randomUUID();

  // Extract HTML (for preview rendering)
  const htmlResult = await mammoth.convertToHtml({ buffer });
  const html = htmlResult.value;

  // Extract raw text
  const textResult = await mammoth.extractRawText({ buffer });
  const rawText = textResult.value;

  // Detect form-like fields from the text (common patterns)
  const fields = detectFormFieldsFromText(rawText, 0);

  // DOCX is treated as a single "page" for simplicity
  const pages: DocumentPage[] = [
    {
      index: 0,
      text: rawText,
      html,
      fields,
    },
  ];

  return {
    sessionId,
    fileName,
    type: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    fileSize: buffer.length,
    pages,
    fields,
    rawText,
    metadata: {},
    totalPages: 1,
  };
}

/* ------------------------------------------------------------------ */
/* PPTX Parser — uses sandbox python-pptx for real parsing             */
/* Fallback: JSZip to extract basic slide text                         */
/* ------------------------------------------------------------------ */

export async function parsePPTX(buffer: Buffer, fileName: string): Promise<ParsedDocument> {
  const sessionId = randomUUID();

  // Basic extraction using JSZip (already in web app deps)
  // For richer parsing, the sandbox python-pptx script is used
  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buffer);

    const pages: DocumentPage[] = [];
    const slideFiles = Object.keys(zip.files)
      .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
      .sort();

    for (let i = 0; i < slideFiles.length; i++) {
      const slideXml = await zip.files[slideFiles[i]].async('text');
      // Extract text from XML (simplified)
      const text = slideXml
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      pages.push({
        index: i,
        text,
        fields: [],
      });
    }

    const fields = pages.flatMap((p) => detectFormFieldsFromText(p.text, p.index));

    return {
      sessionId,
      fileName,
      type: 'pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      fileSize: buffer.length,
      pages,
      fields,
      rawText: pages.map((p) => p.text).join('\n\n'),
      metadata: {},
      totalPages: pages.length,
    };
  } catch {
    return {
      sessionId,
      fileName,
      type: 'pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      fileSize: buffer.length,
      pages: [],
      fields: [],
      rawText: '',
      metadata: {},
      totalPages: 0,
    };
  }
}

/* ------------------------------------------------------------------ */
/* TXT Parser — native passthrough                                     */
/* ------------------------------------------------------------------ */

export async function parseTXT(buffer: Buffer, fileName: string): Promise<ParsedDocument> {
  const sessionId = randomUUID();
  const rawText = buffer.toString('utf-8');

  const fields = detectFormFieldsFromText(rawText, 0);

  return {
    sessionId,
    fileName,
    type: 'txt',
    mimeType: 'text/plain',
    fileSize: buffer.length,
    pages: [
      {
        index: 0,
        text: rawText,
        fields,
      },
    ],
    fields,
    rawText,
    metadata: {},
    totalPages: 1,
  };
}

/* ------------------------------------------------------------------ */
/* Unified parser                                                      */
/* ------------------------------------------------------------------ */

export async function parseDocument(
  buffer: Buffer,
  fileName: string,
  mimeType?: string,
): Promise<ParsedDocument> {
  const type = detectDocumentType(fileName, mimeType);
  if (!type) {
    throw new Error(`Unsupported file type: ${fileName}`);
  }

  switch (type) {
    case 'pdf':
      return parsePDF(buffer, fileName);
    case 'docx':
      return parseDOCX(buffer, fileName);
    case 'pptx':
      return parsePPTX(buffer, fileName);
    case 'txt':
      return parseTXT(buffer, fileName);
    default:
      throw new Error(`Parser not implemented for type: ${type}`);
  }
}

/* ------------------------------------------------------------------ */
/* Heuristic form field detection from unstructured text               */
/* ------------------------------------------------------------------ */

/**
 * Detects form-like patterns in text:
 * - "Name: ___________"
 * - "Date: "
 * - "Email: "
 * - "[  ]" checkboxes
 * - Lines ending with ":" followed by blank/underscores
 */
function detectFormFieldsFromText(text: string, pageIndex: number): DocumentField[] {
  const fields: DocumentField[] = [];
  const lines = text.split('\n');

  const labelPatterns = [
    // "Label: ___" or "Label: " (blank after colon)
    /^(.+?):\s*[_\s]{3,}$/,
    // "Label: " at end of line
    /^(.+?):\s*$/,
    // "[  ] Label" — checkbox
    /^\[[\sx]\]\s+(.+)$/i,
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 3) continue;

    // Check for checkbox pattern
    const checkMatch = trimmed.match(/^\[([\sx])\]\s+(.+)$/i);
    if (checkMatch) {
      fields.push({
        id: `detected_${fields.length}`,
        name: checkMatch[2].trim(),
        type: 'checkbox',
        value: checkMatch[1].toLowerCase() === 'x' ? 'true' : 'false',
        pageIndex,
      });
      continue;
    }

    // Check for label: value patterns
    const labelMatch = trimmed.match(/^(.+?):\s*([_\s]*)$/);
    if (labelMatch && labelMatch[1].length < 60) {
      const label = labelMatch[1].trim();
      // Detect field type from label name
      const lowerLabel = label.toLowerCase();
      let fieldType: DocumentField['type'] = 'text';

      if (lowerLabel.includes('date') || lowerLabel.includes('dob')) {
        fieldType = 'date';
      } else if (
        lowerLabel.includes('description') ||
        lowerLabel.includes('comments') ||
        lowerLabel.includes('notes') ||
        lowerLabel.includes('address')
      ) {
        fieldType = 'textarea';
      } else if (
        lowerLabel.includes('email') ||
        lowerLabel.includes('phone') ||
        lowerLabel.includes('number') ||
        lowerLabel.includes('amount') ||
        lowerLabel.includes('zip') ||
        lowerLabel.includes('code')
      ) {
        fieldType = lowerLabel.includes('email') ? 'text' : 'text';
      }

      fields.push({
        id: `detected_${fields.length}`,
        name: label,
        type: fieldType,
        value: '',
        pageIndex,
        placeholder: `Enter ${label.toLowerCase()}`,
      });
    }
  }

  return fields;
}
