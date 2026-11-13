// Model-facing prompt for extracting what is visible on a single PDF page.
// Domain-aware (figures, plots, Kaplan-Meier vs raw-data medians); lifted
// verbatim from the chat route. Edit only through the benchmark regression gate.

/** Build the per-page PDF visual-extraction prompt for the given user question. */
export function pdfPageExtractionPrompt(userText: string): string {
  return `Extract only what is visible on this PDF page for the question below. Start with the exact figure/table title and caption, including any population qualifier in parentheses. For plots, transcribe axes, units, legend labels, annotated values, thresholds, and any embedded at-risk table with each time point aligned to its arm. For proper names and treatment labels, compare the visual reading with the extracted text of the same inspected PDF page; use the extracted page-text spelling when they differ, while keeping numeric values from the rendered figure. For diagrams, transcribe each box, arrow, label, and number. For structured tables, preserve row and column headers. Pair each mark with its axis label; verify highlighted or extreme values against neighboring marks and labels. Distinguish a Kaplan-Meier estimate from a raw-data median and do not substitute one for the other. Do not transfer a value from another figure on the same page. Do not answer the combined question or infer any counts or facts from CSV, spreadsheets, or other files. If a requested fact belongs to another file, leave it out entirely.\n\nQuestion: ${userText}`;
}
