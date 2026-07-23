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

export function restoreSession(session: EditorSession): void {
  sessions.set(session.id, session);
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
    console.error(
      `[doc-editor] Session not found: ${sessionId}. Available sessions:`,
      Array.from(sessions.keys()),
    );
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

    // Map field IDs to actual field names for native PDF filling and sandbox scripts.
    // The LLM sends field IDs like "pdf_field_0"; we resolve them to the actual PDF field names.
    // If the ID doesn't match any field, try matching by name directly (case-insensitive).
    const resolvedEdits = edits.map((edit) => {
      // Primary: look up by ID
      let field = session.parsed.fields.find((f) => f.id === edit.fieldId);
      if (!field) {
        // Fallback: match by name (case-insensitive, trimmed)
        const needle = edit.fieldId.trim().toLowerCase();
        field = session.parsed.fields.find((f) => f.name.trim().toLowerCase() === needle);
      }
      if (!field) {
        // Fallback: match by partial name containment
        const needle = edit.fieldId.trim().toLowerCase();
        field = session.parsed.fields.find(
          (f) =>
            f.name.trim().toLowerCase().includes(needle) ||
            needle.includes(f.name.trim().toLowerCase()),
        );
      }
      const resolvedName = field ? field.name : edit.fieldId;
      console.log(
        `[doc-editor] Resolving fieldId "${
          edit.fieldId
        }" → "${resolvedName}" (matched: ${!!field})`,
      );
      return {
        ...edit,
        fieldId: resolvedName,
      };
    });

    switch (session.type) {
      case 'pdf': {
        // Use pdf-lib natively for PDF form filling (no sandbox needed!)
        const fillResult = await fillPDFNatively(buffer, resolvedEdits);
        resultBuffer = fillResult.buffer;
        updatedFields = fillResult.matchedFields;
        if (fillResult.matchedFields.length === 0) {
          console.warn(
            `[doc-editor] WARNING: fillPDFNatively matched 0 fields. Edits:`,
            resolvedEdits.map((e) => e.fieldId),
          );
        }
        break;
      }

      case 'docx': {
        // Use sandbox python-docx
        const script = generateFillDOCXScript(resolvedEdits);
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
        const script = generateFillPPTXScript(resolvedEdits);
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
        for (let i = 0; i < edits.length; i++) {
          const edit = edits[i];
          const resolvedEdit = resolvedEdits[i];
          if (edit.type === 'fill' || edit.type === 'replace') {
            // Replace "Label: ___" with "Label: value"
            const pattern = new RegExp(`(${escapeRegExp(resolvedEdit.fieldId)}:\\s*)[_\\s]*`, 'i');
            text = text.replace(pattern, `$1${edit.value}`);
            updatedFields.push(edit.fieldId);
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
    console.error('[doc-editor] applyFieldEdits error:', err);
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

async function fillPDFNatively(
  buffer: Buffer,
  edits: FieldEdit[],
): Promise<{ buffer: Buffer; matchedFields: string[] }> {
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const form = pdfDoc.getForm();
  const allFields = form.getFields();
  const matchedFields: string[] = [];

  const allFieldNames = allFields.map((f) => f.getName());
  console.log(
    `[doc-editor] fillPDFNatively: ${allFields.length} PDF fields: [${allFieldNames.join(', ')}]`,
  );
  console.log(`[doc-editor] fillPDFNatively: ${edits.length} edits to apply`);

  for (const edit of edits) {
    let matched = false;
    // Find the matching field by name
    for (const field of allFields) {
      const fieldName = field.getName();
      const editId = edit.fieldId;

      // Match by exact name, case-insensitive name, or containment
      const isMatch =
        fieldName === editId ||
        fieldName.toLowerCase() === editId.toLowerCase() ||
        editId.toLowerCase().endsWith(fieldName.toLowerCase()) ||
        fieldName.toLowerCase().includes(editId.toLowerCase()) ||
        editId.toLowerCase().includes(fieldName.toLowerCase());

      if (isMatch) {
        if (edit.type === 'clear') {
          if (field instanceof PDFTextField) {
            field.setText('');
          }
          matched = true;
          matchedFields.push(fieldName);
          console.log(`[doc-editor] Cleared field "${fieldName}"`);
          break;
        }

        if (field instanceof PDFTextField) {
          field.setText(edit.value);
          matched = true;
          matchedFields.push(fieldName);
          console.log(
            `[doc-editor] Filled text field "${fieldName}" with "${edit.value.substring(0, 50)}${
              edit.value.length > 50 ? '...' : ''
            }"`,
          );
        } else if (field instanceof PDFCheckBox) {
          if (edit.value === 'true' || edit.value === 'yes' || edit.value === '1') {
            field.check();
          } else {
            field.uncheck();
          }
          matched = true;
          matchedFields.push(fieldName);
        } else if (field instanceof PDFDropdown) {
          try {
            field.select(edit.value);
            matched = true;
            matchedFields.push(fieldName);
          } catch {
            // Value might not be in options
          }
        } else if (field instanceof PDFRadioGroup) {
          try {
            field.select(edit.value);
            matched = true;
            matchedFields.push(fieldName);
          } catch {
            // Value might not be in options
          }
        }
        break;
      }
    }

    if (!matched) {
      console.warn(`[doc-editor] No matching PDF field found for edit "${edit.fieldId}"`);
    }
  }

  console.log(
    `[doc-editor] fillPDFNatively: matched ${matchedFields.length}/${edits.length} fields`,
  );

  // Very Important: update field appearances so the changes are visible in all PDF viewers!
  try {
    const defaultFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    form.updateFieldAppearances(defaultFont);
  } catch (e) {
    console.error('Failed to update field appearances, ignoring', e);
  }

  const modifiedBytes = await pdfDoc.save();
  return { buffer: Buffer.from(modifiedBytes), matchedFields };
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
    // ALWAYS re-sign from the original (unsigned) document to replace, not stack.
    // Only use base64Override if explicitly provided from the frontend for undo flows.
    const sourceBase64 = data.base64Override || session.originalFileBase64;
    const buffer = Buffer.from(sourceBase64, 'base64');

    if (session.mimeType === 'application/pdf') {
      const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const pages = pdfDoc.getPages();
      const pageIndex = Math.min(Math.max(0, data.pageIndex), pages.length - 1);
      const page = pages[pageIndex];

      const { width, height } = page.getSize();

      // --- Smart Placement: try to find the detected context text position ---
      let resolvedX: number | null = null;
      let resolvedY: number | null = null;

      if (data.detectedContext) {
        try {
          // Use sandbox PyPDF to find text coordinates on this page
          const coords = await findTextPositionOnPage(buffer, pageIndex, data.detectedContext);
          if (coords) {
            // Place signature right below the detected text line
            resolvedX = coords.x;
            // coords.y is the bottom of the text in PDF coordinate system
            // Place signature just below (subtract a small offset for spacing)
            resolvedY = coords.y - 10;
          }
        } catch {
          // Fallback to UI-provided coordinates
        }
      }

      // Fall back to user-specified percentages
      if (resolvedX === null || resolvedY === null) {
        const xPct = data.x ?? 50;
        const yPct = data.y ?? 50;
        resolvedX = (xPct / 100) * width;
        // Invert Y: UI treats y=0 as top, PDF treats y=0 as bottom
        resolvedY = height - (yPct / 100) * height;
      }

      const x = resolvedX;
      const y = resolvedY;

      if (data.mode === 'type' && data.text) {
        const font = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

        let color = rgb(0, 0, 0);
        if (data.color === 'blue') color = rgb(0, 0, 1);
        if (data.color === 'red') color = rgb(1, 0, 0);

        const size = 24 * (data.scale ?? 1);
        page.drawText(data.text, {
          x,
          y: y - size, // Adjust for PDF drawing from baseline instead of top-left
          size,
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

        const intrinsicHeight = embeddedImage.height;
        let drawHeight = intrinsicHeight;
        let drawWidth = embeddedImage.width;

        // Match frontend's max-h-[60px] behavior
        if (intrinsicHeight > 60) {
          const ratio = 60 / intrinsicHeight;
          drawHeight = 60;
          drawWidth = drawWidth * ratio;
        }

        // Apply user scale
        drawHeight *= data.scale ?? 1;
        drawWidth *= data.scale ?? 1;

        page.drawImage(embeddedImage, {
          x,
          y: y - drawHeight, // Top-left alignment based on bottom-left drawing
          width: drawWidth,
          height: drawHeight,
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

      // Re-parse the document so the canvas preview updates properly
      const newBuffer = Buffer.from(modifiedBytes);
      const newParsed = await parseDocument(newBuffer, session.fileName, session.mimeType);
      newParsed.sessionId = sessionId;

      session.currentFileBase64 = newBase64;
      session.parsed = newParsed;
      session.updatedAt = new Date().toISOString();
      sessions.set(sessionId, session);

      return {
        success: true,
        parsed: newParsed,
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
/* Find text position on a PDF page using sandbox PyPDF               */
/* ------------------------------------------------------------------ */

async function findTextPositionOnPage(
  pdfBuffer: Buffer,
  pageIndex: number,
  searchText: string,
): Promise<{ x: number; y: number } | null> {
  try {
    const code = `
import json, sys
try:
    import pypdf
    reader = pypdf.PdfReader("document.pdf")
    page = reader.pages[${pageIndex}]
    
    search = ${JSON.stringify(searchText)}.lower()
    
    # Extract text with visitor to get positions
    positions = []
    def visitor(text, cm, tm, font_dict, font_size):
        if text and text.strip():
            x = tm[4]
            y = tm[5]
            positions.append({"text": text.strip(), "x": float(x), "y": float(y)})
    
    page.extract_text(visitor_text=visitor)
    
    # Find the best match
    best = None
    best_score = 0
    for pos in positions:
        t = pos["text"].lower()
        # Check if search text is contained in this text segment or vice versa
        if search in t or t in search:
            score = len(t)
            if score > best_score:
                best_score = score
                best = pos
        # Also check word overlap
        search_words = set(search.split())
        text_words = set(t.split())
        overlap = len(search_words & text_words)
        if overlap > best_score:
            best_score = overlap
            best = pos
    
    if best:
        print("__RESULT__:" + json.dumps({"x": best["x"], "y": best["y"]}))
    else:
        print("__RESULT__:null")
except Exception as e:
    print("__RESULT__:null")
    print(f"Error: {e}", file=sys.stderr)
`;

    const sandboxManager = new SandboxManager({ backend: 'docker' });
    const result = await sandboxManager.execute({
      code,
      language: 'python',
      files: [
        {
          name: 'document.pdf',
          content: pdfBuffer.toString('base64'),
          isBase64: true,
        },
      ],
      timeout: 15_000,
    });

    if (result.exitCode === 0) {
      const match = result.stdout.match(/__RESULT__:(.+)/);
      if (match) {
        const parsed = JSON.parse(match[1]);
        if (parsed && typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          return { x: parsed.x, y: parsed.y };
        }
      }
    }
  } catch {
    // Sandbox not available — fall back to UI coordinates
  }

  return null;
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
