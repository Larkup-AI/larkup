// Model-facing context block injected when the user is editing a Canvas
// document. Lifted verbatim from the chat route (behavior-preserving).

export interface DocumentFormField {
  id: string;
  name: string;
  type: string;
  value?: string;
  context?: string;
  placeholder?: string;
}

/**
 * Build the document-session context for the system prompt. Returns '' when
 * there is no active document session, matching the original inline behavior.
 * The field listing lets the model match semantic meaning to field IDs.
 */
export function buildDocumentSessionContext(
  docSessionId: string | undefined,
  docFields: DocumentFormField[] | undefined,
): string {
  if (!docSessionId) return '';
  const fieldLines =
    docFields && docFields.length > 0
      ? (docFields as any[])
          .map((f: any) => {
            let line = `- ID: "${f.id}" | Label: "${f.name}" | Type: ${f.type}`;
            if (f.value) line += ` | Current value: "${f.value}"`;
            if (f.context) line += ` | Surrounding text: "${String(f.context).slice(0, 120)}"`;
            if (f.placeholder) line += ` | Placeholder: "${f.placeholder}"`;
            return line;
          })
          .join('\n')
      : 'None detected.';
  return `\n\n[Active Document Session: ${docSessionId}]\nYou are currently editing a document in the Canvas.
The user may ask you to fill out form fields or edit content.
IMPORTANT: Use the exact field IDs listed below when calling "fillDocumentForm". Do NOT invent field IDs.
Available Form Fields (${docFields?.length ?? 0} total):
${fieldLines}`;
}
