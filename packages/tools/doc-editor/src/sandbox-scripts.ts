/**
 * Python code templates for sandbox-based document editing.
 *
 * These scripts run inside the Docker sandbox with:
 * - pypdf: PDF form field filling
 * - python-docx: Word document editing
 * - python-pptx: PowerPoint editing
 * - Pillow: Image processing
 *
 * All scripts expect input files in /sandbox/input/ and output to /sandbox/output/
 */

import type { FieldEdit, ContentEdit } from './types';

/* ------------------------------------------------------------------ */
/* PDF — Fill form fields using pypdf                                  */
/* ------------------------------------------------------------------ */

export function generateFillPDFScript(edits: FieldEdit[]): string {
  const editsJson = JSON.stringify(edits);

  return `
import json
import sys
from pypdf import PdfReader, PdfWriter

# Load the PDF
reader = PdfReader("/sandbox/input/document.pdf")
writer = PdfWriter()

# Copy all pages
for page in reader.pages:
    writer.add_page(page)

# Copy existing form fields
if reader.is_form:
    writer.clone_reader_document_root(reader)

# Parse edits
edits = json.loads('''${editsJson}''')

# Build field value map (field_name -> value)
field_map = {}
for edit in edits:
    field_map[edit["fieldId"]] = edit["value"]

# Apply form field fills
if reader.is_form:
    fields = reader.get_fields()
    update_dict = {}
    for field_name, field_obj in (fields or {}).items():
        for edit_id, value in field_map.items():
            # Match by name or by detected ID pattern
            if field_name == edit_id or edit_id.endswith(field_name):
                update_dict[field_name] = value
                break

    if update_dict:
        writer.update_page_form_field_values(writer.pages[0], update_dict)

# Save
with open("/sandbox/output/document.pdf", "wb") as f:
    writer.write(f)

print(f"SUCCESS: Updated {len(field_map)} fields")
`;
}

/* ------------------------------------------------------------------ */
/* PDF — Extract full text using pypdf                                 */
/* ------------------------------------------------------------------ */

export function generateExtractPDFTextScript(): string {
  return `
import json
from pypdf import PdfReader

reader = PdfReader("/sandbox/input/document.pdf")
pages = []

for i, page in enumerate(reader.pages):
    text = page.extract_text() or ""
    pages.append({
        "index": i,
        "text": text,
    })

# Extract form fields
fields = []
if reader.is_form:
    form_fields = reader.get_fields() or {}
    for name, field in form_fields.items():
        field_type = str(field.get("/FT", ""))
        value = str(field.get("/V", ""))
        fields.append({
            "name": name,
            "type": field_type,
            "value": value,
        })

result = {
    "pages": pages,
    "fields": fields,
    "totalPages": len(reader.pages),
    "metadata": dict(reader.metadata or {}),
}

print("__RESULT__:" + json.dumps(result, default=str))
`;
}

/* ------------------------------------------------------------------ */
/* DOCX — Edit content using python-docx                               */
/* ------------------------------------------------------------------ */

export function generateEditDOCXScript(edits: ContentEdit[]): string {
  const editsJson = JSON.stringify(edits);

  return `
import json
from docx import Document

doc = Document("/sandbox/input/document.docx")
edits = json.loads('''${editsJson}''')

updated = 0
for edit in edits:
    edit_type = edit.get("type", "replace_text")

    if edit_type == "replace_text":
        search = edit.get("search", "")
        replacement = edit.get("text", "")

        for para in doc.paragraphs:
            if search in para.text:
                # Preserve formatting by replacing in runs
                full_text = ""
                for run in para.runs:
                    full_text += run.text

                if search in full_text:
                    # Simple replacement — replace in runs
                    remaining = search
                    for run in para.runs:
                        if remaining and remaining in run.text:
                            run.text = run.text.replace(remaining, replacement, 1)
                            remaining = ""
                            updated += 1
                            break
                        elif remaining and run.text and remaining.startswith(run.text):
                            remaining = remaining[len(run.text):]
                            run.text = ""

        # Also check tables
        for table in doc.tables:
            for row in table.rows:
                for cell in row.cells:
                    for para in cell.paragraphs:
                        if search in para.text:
                            for run in para.runs:
                                if search in run.text:
                                    run.text = run.text.replace(search, replacement, 1)
                                    updated += 1

    elif edit_type == "insert_text":
        text = edit.get("text", "")
        position = edit.get("position", len(doc.paragraphs))
        if position < len(doc.paragraphs):
            para = doc.paragraphs[position]
            para.insert_paragraph_before(text)
        else:
            doc.add_paragraph(text)
        updated += 1

doc.save("/sandbox/output/document.docx")
print(f"SUCCESS: Applied {updated} edits")
`;
}

/* ------------------------------------------------------------------ */
/* DOCX — Fill form fields (content controls / placeholder text)       */
/* ------------------------------------------------------------------ */

export function generateFillDOCXScript(edits: FieldEdit[]): string {
  const editsJson = JSON.stringify(edits);

  return `
import json
from docx import Document

doc = Document("/sandbox/input/document.docx")
edits = json.loads('''${editsJson}''')

# Build lookup
field_map = {edit["fieldId"]: edit["value"] for edit in edits}

updated = 0

# Strategy 1: Look for common form patterns like "Label: ___" or "Label: "
for para in doc.paragraphs:
    for field_id, value in field_map.items():
        # The field_id contains the label name from detection
        label = field_id.replace("detected_", "").strip()
        
        # Check if paragraph contains "Label:" pattern
        text = para.text
        for run in para.runs:
            if "___" in run.text or (run.text.strip().endswith(":") and not value):
                # Replace underscores with value
                run.text = run.text.replace("___", value).rstrip("_")
                updated += 1

# Strategy 2: Check tables (common in forms)
for table in doc.tables:
    for row in table.rows:
        cells = row.cells
        for i, cell in enumerate(cells):
            cell_text = cell.text.strip().rstrip(":")
            # If this cell's text matches a field name, fill the next cell
            for field_id, value in field_map.items():
                if cell_text.lower() == field_id.lower() and i + 1 < len(cells):
                    next_cell = cells[i + 1]
                    for para in next_cell.paragraphs:
                        if para.runs:
                            para.runs[0].text = value
                        else:
                            para.text = value
                    updated += 1

doc.save("/sandbox/output/document.docx")
print(f"SUCCESS: Filled {updated} fields")
`;
}

/* ------------------------------------------------------------------ */
/* PPTX — Extract text from slides                                     */
/* ------------------------------------------------------------------ */

export function generateExtractPPTXScript(): string {
  return `
import json
from pptx import Presentation
from pptx.util import Inches, Pt

prs = Presentation("/sandbox/input/document.pptx")
slides = []

for i, slide in enumerate(prs.slides):
    texts = []
    fields = []
    
    for shape in slide.shapes:
        if shape.has_text_frame:
            for para in shape.text_frame.paragraphs:
                text = para.text.strip()
                if text:
                    texts.append(text)
                    
                    # Detect form-like patterns
                    if ":" in text and text.endswith(":"):
                        fields.append({
                            "name": text.rstrip(":").strip(),
                            "type": "text",
                            "value": "",
                            "slideIndex": i,
                        })
                    elif "___" in text:
                        label = text.split("___")[0].strip().rstrip(":")
                        if label:
                            fields.append({
                                "name": label,
                                "type": "text",
                                "value": "",
                                "slideIndex": i,
                            })
    
    slides.append({
        "index": i,
        "text": "\\n".join(texts),
        "fields": fields,
    })

result = {
    "slides": slides,
    "totalSlides": len(prs.slides),
}

print("__RESULT__:" + json.dumps(result, default=str))
`;
}

/* ------------------------------------------------------------------ */
/* PPTX — Edit slide text                                              */
/* ------------------------------------------------------------------ */

export function generateEditPPTXScript(edits: ContentEdit[]): string {
  const editsJson = JSON.stringify(edits);

  return `
import json
from pptx import Presentation

prs = Presentation("/sandbox/input/document.pptx")
edits = json.loads('''${editsJson}''')

updated = 0
for edit in edits:
    slide_index = edit.get("pageIndex", 0)
    if slide_index >= len(prs.slides):
        continue
    
    slide = prs.slides[slide_index]
    edit_type = edit.get("type", "replace_text")
    
    if edit_type == "replace_text":
        search = edit.get("search", "")
        replacement = edit.get("text", "")
        
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    for run in para.runs:
                        if search in run.text:
                            run.text = run.text.replace(search, replacement)
                            updated += 1

prs.save("/sandbox/output/document.pptx")
print(f"SUCCESS: Applied {updated} edits")
`;
}

/* ------------------------------------------------------------------ */
/* PPTX — Fill form fields in slides                                   */
/* ------------------------------------------------------------------ */

export function generateFillPPTXScript(edits: FieldEdit[]): string {
  const editsJson = JSON.stringify(edits);

  return `
import json
from pptx import Presentation

prs = Presentation("/sandbox/input/document.pptx")
edits = json.loads('''${editsJson}''')

field_map = {edit["fieldId"]: edit["value"] for edit in edits}
updated = 0

for slide in prs.slides:
    for shape in slide.shapes:
        if shape.has_text_frame:
            for para in shape.text_frame.paragraphs:
                full_text = para.text
                for field_id, value in field_map.items():
                    # Replace "___" blanks after field labels
                    if "___" in full_text:
                        for run in para.runs:
                            if "___" in run.text:
                                run.text = run.text.replace("___", value, 1)
                                updated += 1

prs.save("/sandbox/output/document.pptx")
print(f"SUCCESS: Filled {updated} fields")
`;
}
