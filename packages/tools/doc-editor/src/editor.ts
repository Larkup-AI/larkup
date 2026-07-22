/**
 * Document editor — orchestrates parsing, editing, and export.
 *
 * Uses:
 * - pdf-lib (MIT) for native PDF form filling
 * - Sandbox scripts for DOCX/PPTX editing via python-docx/python-pptx
 * - In-memory session management
 */

import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFRadioGroup,
  rgb,
  StandardFonts,
} from 'pdf-lib';
import { SandboxManager } from '@larkup/sandbox';
import type { EditorSession, FieldEdit, ContentEdit, EditResult, SignatureData } from './types.js';
import { parseDocument, enrichPDFWithText } from './parsers.js';
import {
  generateFillDOCXScript,
  generateFillPPTXScript,
  generateEditDOCXScript,
  generateEditPPTXScript,
  generateExtractPDFTextScript,
} from './sandbox-scripts.js';

const sessions = new Map<string, EditorSession>();

export function getSession(sessionId: string): EditorSession | undefined {
  return sessions.get(sessionId);
}

export function getAllSessions(): EditorSession[] {
  return Array.from(sessions.values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export function deleteSession(sessionId: string): boolean {
  return sessions.delete(sessionId);
}

/* ------------------------------------------------------------------ */
/* Create session — parse and store document                           */
/* ------------------------------------------------------------------ */

export async function createSession(
  buffer: Buffer,
  fileName: string,
  mimeType?: string,
): Promise<EditorSession> {
  // Parse the document
  let parsed = await parseDocument(buffer, fileName, mimeType);

  // For PDFs, try to extract text via sandbox for richer content
  // Skip heavy extraction for long PDFs (e.g. > 5 pages) to just "view" them quickly
  if (parsed.type === 'pdf' && parsed.rawText === '' && parsed.totalPages <= 5) {
    try {
      const sandboxResult = await runSandboxScript(
        generateExtractPDFTextScript(),
        buffer,
        'document.pdf',
      );

      if (sandboxResult.exitCode === 0) {
        const resultMatch = sandboxResult.stdout.match(/__RESULT__:(.+)/);
        if (resultMatch) {
          const extracted = JSON.parse(resultMatch[1]);
          const pageTexts = (extracted.pages || [])
            .map((p: { text: string }) => p.text)
            .join('\n\n\n');
          parsed = enrichPDFWithText(parsed, pageTexts);

          // Enrich fields from sandbox pypdf extraction
          if (extracted.fields && extracted.fields.length > 0) {
            for (const f of extracted.fields) {
              const exists = parsed.fields.some((pf) => pf.name === f.name);
              if (!exists) {
                parsed.fields.push({
                  id: `sandbox_field_${parsed.fields.length}`,
                  name: f.name,
                  type: f.type === '/Tx' ? 'text' : 'text',
                  value: f.value || '',
                  pageIndex: 0,
                });
              }
            }
          }
        }
      }
    } catch {
      // Sandbox not available — continue with basic extraction
    }
  }

  const fileBase64 = buffer.toString('base64');
  const session: EditorSession = {
    id: parsed.sessionId,
    fileName,
    type: parsed.type,
    mimeType: parsed.mimeType,
    originalFileBase64: fileBase64,
    currentFileBase64: fileBase64,
    parsed,
    edits: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  sessions.set(session.id, session);
  return session;
}

/* ------------------------------------------------------------------ */
/* Apply field edits                                                   */
/* ------------------------------------------------------------------ */

export async function applyFieldEdits(sessionId: string, edits: FieldEdit[]): Promise<EditResult> {
  const session = sessions.get(sessionId);
  if (!session) {
    return {
      success: false,
      parsed: null as any,
      fileBase64: '',
      error: 'Session not found',
      updatedFields: [],
    };
  }

  const buffer = Buffer.from(session.currentFileBase64, 'base64');

  try {
    let resultBuffer: Buffer;
    let updatedFields: string[] = [];

    switch (session.type) {
      case 'pdf': {
        // Use pdf-lib natively for PDF form filling (no sandbox needed!)
        resultBuffer = await fillPDFNatively(buffer, edits);
        updatedFields = edits.map((e) => e.fieldId);
        break;
      }

      case 'docx': {
        // Use sandbox python-docx
        const script = generateFillDOCXScript(edits);
        const result = await runSandboxScript(script, buffer, 'document.docx');

        if (result.exitCode !== 0) {
          return {
            success: false,
            parsed: session.parsed,
            fileBase64: session.currentFileBase64,
            error: result.stderr || 'DOCX edit failed',
            updatedFields: [],
          };
        }

        // Get the modified file from sandbox artifacts
        const artifact = result.artifacts.find((a) => a.name === 'document.docx');
        if (!artifact) {
          return {
            success: false,
            parsed: session.parsed,
            fileBase64: session.currentFileBase64,
            error: 'Modified file not returned from sandbox',
            updatedFields: [],
          };
        }

        resultBuffer = Buffer.from(artifact.data, 'base64');
        updatedFields = edits.map((e) => e.fieldId);
        break;
      }

      case 'pptx': {
        // Use sandbox python-pptx
        const script = generateFillPPTXScript(edits);
        const result = await runSandboxScript(script, buffer, 'document.pptx');

        if (result.exitCode !== 0) {
          return {
            success: false,
            parsed: session.parsed,
            fileBase64: session.currentFileBase64,
            error: result.stderr || 'PPTX edit failed',
            updatedFields: [],
          };
        }

        const artifact = result.artifacts.find((a) => a.name === 'document.pptx');
        if (!artifact) {
          return {
            success: false,
            parsed: session.parsed,
            fileBase64: session.currentFileBase64,
            error: 'Modified file not returned from sandbox',
            updatedFields: [],
          };
        }

        resultBuffer = Buffer.from(artifact.data, 'base64');
        updatedFields = edits.map((e) => e.fieldId);
        break;
      }

      case 'txt': {
        // Direct text editing — apply replacements
        let text = buffer.toString('utf-8');
        for (const edit of edits) {
          // For TXT, fieldId contains the search text
          if (edit.type === 'fill' || edit.type === 'replace') {
            // Update field values in-place
            const field = session.parsed.fields.find((f) => f.id === edit.fieldId);
            if (field) {
              // Replace "Label: ___" with "Label: value"
              const pattern = new RegExp(`(${escapeRegExp(field.name)}:\\s*)[_\\s]*`, 'i');
              text = text.replace(pattern, `$1${edit.value}`);
              updatedFields.push(edit.fieldId);
            }
          }
        }
        resultBuffer = Buffer.from(text, 'utf-8');
        break;
      }

      default:
        return {
          success: false,
          parsed: session.parsed,
          fileBase64: session.currentFileBase64,
          error: `Editing not supported for type: ${session.type}`,
          updatedFields: [],
        };
    }

    // Re-parse the modified document
    const newParsed = await parseDocument(resultBuffer, session.fileName, session.mimeType);
    newParsed.sessionId = sessionId;

    // Update session
    const newBase64 = resultBuffer.toString('base64');
    session.currentFileBase64 = newBase64;
    session.parsed = newParsed;
    session.edits.push(...edits);
    session.updatedAt = new Date().toISOString();

    return {
      success: true,
      parsed: newParsed,
      fileBase64: newBase64,
      updatedFields,
    };
  } catch (err: any) {
    return {
      success: false,
      parsed: session.parsed,
      fileBase64: session.currentFileBase64,
      error: err.message ?? 'Edit failed',
      updatedFields: [],
    };
  }
}

/* ------------------------------------------------------------------ */
/* Apply content edits (text-level)                                    */
/* ------------------------------------------------------------------ */

export async function applyContentEdits(
  sessionId: string,
  edits: ContentEdit[],
): Promise<EditResult> {
  const session = sessions.get(sessionId);
  if (!session) {
    return {
      success: false,
      parsed: null as any,
      fileBase64: '',
      error: 'Session not found',
      updatedFields: [],
    };
  }

  const buffer = Buffer.from(session.currentFileBase64, 'base64');

  try {
    let resultBuffer: Buffer;

    switch (session.type) {
      case 'docx': {
        const script = generateEditDOCXScript(edits);
        const result = await runSandboxScript(script, buffer, 'document.docx');

        if (result.exitCode !== 0) {
          return {
            success: false,
            parsed: session.parsed,
            fileBase64: session.currentFileBase64,
            error: result.stderr || 'DOCX edit failed',
            updatedFields: [],
          };
        }

        const artifact = result.artifacts.find((a) => a.name === 'document.docx');
        resultBuffer = artifact ? Buffer.from(artifact.data, 'base64') : buffer;
        break;
      }

      case 'pptx': {
        const script = generateEditPPTXScript(edits);
        const result = await runSandboxScript(script, buffer, 'document.pptx');

        if (result.exitCode !== 0) {
          return {
            success: false,
            parsed: session.parsed,
            fileBase64: session.currentFileBase64,
            error: result.stderr || 'PPTX edit failed',
            updatedFields: [],
          };
        }

        const artifact = result.artifacts.find((a) => a.name === 'document.pptx');
        resultBuffer = artifact ? Buffer.from(artifact.data, 'base64') : buffer;
        break;
      }

      case 'txt': {
        let text = buffer.toString('utf-8');
        for (const edit of edits) {
          if (edit.type === 'replace_text' && edit.search) {
            text = text.replace(edit.search, edit.text);
          } else if (edit.type === 'insert_text') {
            const lines = text.split('\n');
            const pos = edit.position ?? lines.length;
            lines.splice(pos, 0, edit.text);
            text = lines.join('\n');
          }
        }
        resultBuffer = Buffer.from(text, 'utf-8');
        break;
      }

      default:
        return {
          success: false,
          parsed: session.parsed,
          fileBase64: session.currentFileBase64,
          error: `Content editing not supported for type: ${session.type}`,
          updatedFields: [],
        };
    }

    const newParsed = await parseDocument(resultBuffer, session.fileName, session.mimeType);
    newParsed.sessionId = sessionId;

    const newBase64 = resultBuffer.toString('base64');
    session.currentFileBase64 = newBase64;
    session.parsed = newParsed;
    session.updatedAt = new Date().toISOString();

    return {
      success: true,
      parsed: newParsed,
      fileBase64: newBase64,
      updatedFields: [],
    };
  } catch (err: any) {
    return {
      success: false,
      parsed: session.parsed,
      fileBase64: session.currentFileBase64,
      error: err.message ?? 'Content edit failed',
      updatedFields: [],
    };
  }
}

/* ------------------------------------------------------------------ */
/* Export the current document                                          */
/* ------------------------------------------------------------------ */

export function exportDocument(
  sessionId: string,
): { buffer: Buffer; fileName: string; mimeType: string } | null {
  const session = sessions.get(sessionId);
  if (!session) return null;

  return {
    buffer: Buffer.from(session.currentFileBase64, 'base64'),
    fileName: session.fileName,
    mimeType: session.mimeType,
  };
}

/* ------------------------------------------------------------------ */
/* Native PDF form filling using pdf-lib (no sandbox needed)           */
/* ------------------------------------------------------------------ */

async function fillPDFNatively(buffer: Buffer, edits: FieldEdit[]): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const form = pdfDoc.getForm();
  const allFields = form.getFields();

  for (const edit of edits) {
    // Find the matching field by name or ID
    for (const field of allFields) {
      const fieldName = field.getName();
      if (
        fieldName === edit.fieldId ||
        edit.fieldId.endsWith(fieldName) ||
        fieldName.includes(edit.fieldId)
      ) {
        if (edit.type === 'clear') {
          if (field instanceof PDFTextField) {
            field.setText('');
          }
          continue;
        }

        if (field instanceof PDFTextField) {
          field.setText(edit.value);
        } else if (field instanceof PDFCheckBox) {
          if (edit.value === 'true' || edit.value === 'yes' || edit.value === '1') {
            field.check();
          } else {
            field.uncheck();
          }
        } else if (field instanceof PDFDropdown) {
          try {
            field.select(edit.value);
          } catch {
            // Value might not be in options
          }
        } else if (field instanceof PDFRadioGroup) {
          try {
            field.select(edit.value);
          } catch {
            // Value might not be in options
          }
        }
        break;
      }
    }
  }

  const modifiedBytes = await pdfDoc.save();
  return Buffer.from(modifiedBytes);
}

/* ------------------------------------------------------------------ */
/* Apply signature using pdf-lib (no sandbox needed)                   */
/* ------------------------------------------------------------------ */

export async function applySignature(sessionId: string, data: SignatureData): Promise<EditResult> {
  const session = sessions.get(sessionId);
  if (!session) {
    return { success: false, error: 'Session not found' } as any;
  }

  try {
    const buffer = Buffer.from(session.currentFileBase64, 'base64');

    if (session.mimeType === 'application/pdf') {
      const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const pages = pdfDoc.getPages();
      const pageIndex = Math.min(Math.max(0, data.pageIndex), pages.length - 1);
      const page = pages[pageIndex];

      const x = data.x ?? 50;
      const y = data.y ?? 50;

      if (data.mode === 'type' && data.text) {
        const font = await pdfDoc.embedFont(StandardFonts.HelveticaOblique); // Using Helvetica Oblique as cursive placeholder

        let color = rgb(0, 0, 0);
        if (data.color === 'blue') color = rgb(0, 0, 1);
        if (data.color === 'red') color = rgb(1, 0, 0);

        page.drawText(data.text, {
          x,
          y,
          size: 24,
          font,
          color,
        });
      } else if ((data.mode === 'draw' || data.mode === 'upload') && data.imagePayload) {
        const isPng = data.imagePayload.startsWith('data:image/png');
        const isJpeg = data.imagePayload.startsWith('data:image/jpeg');

        // Strip data URL prefix
        const base64Data = data.imagePayload.replace(/^data:image\/\w+;base64,/, '');
        const imageBytes = Buffer.from(base64Data, 'base64');

        let embeddedImage;
        if (isJpeg) {
          embeddedImage = await pdfDoc.embedJpg(imageBytes);
        } else {
          embeddedImage = await pdfDoc.embedPng(imageBytes); // default PNG
        }

        const dims = embeddedImage.scale(0.5); // scale down
        page.drawImage(embeddedImage, {
          x,
          y,
          width: dims.width,
          height: dims.height,
        });
      }

      if (data.date) {
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        page.drawText(`Date: ${data.date}`, {
          x,
          y: y - 20,
          size: 12,
          font,
          color: rgb(0, 0, 0),
        });
      }

      if (data.extraText) {
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        page.drawText(data.extraText, {
          x,
          y: y - 40,
          size: 12,
          font,
          color: rgb(0, 0, 0),
        });
      }

      const modifiedBytes = await pdfDoc.save();
      const newBase64 = Buffer.from(modifiedBytes).toString('base64');

      session.currentFileBase64 = newBase64;
      session.updatedAt = new Date().toISOString();
      sessions.set(sessionId, session);

      return {
        success: true,
        parsed: session.parsed!,
        fileBase64: newBase64,
        updatedFields: [],
      };
    } else {
      return { success: false, error: 'Signatures only supported for PDF natively' } as any;
    }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to apply signature' } as any;
  }
}

/* ------------------------------------------------------------------ */
/* Sandbox execution helper                                            */
/* ------------------------------------------------------------------ */

async function runSandboxScript(
  code: string,
  fileBuffer: Buffer,
  inputFileName: string,
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  artifacts: { name: string; mimeType: string; data: string }[];
}> {
  const sandboxManager = new SandboxManager({ backend: 'docker' });

  const result = await sandboxManager.execute({
    code,
    language: 'python',
    files: [
      {
        name: inputFileName,
        content: fileBuffer.toString('base64'),
        isBase64: true,
      },
    ],
    timeout: 30_000,
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    artifacts: result.artifacts.map((a) => ({
      name: a.name,
      mimeType: a.mimeType,
      data: a.data,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
