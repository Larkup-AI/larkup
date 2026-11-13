export const PERSONALIZED_RESPONSE_STYLE = `
Start with the answer naturally and directly, without routine search narration. Preserve traceability: name the supporting file, page, table, figure, or timestamp when available, and keep each citation beside the claim it supports. For calculations, state the source population, filters, units, time period, and numerator/denominator when relevant. Before pairing a percentage with numeric inputs, verify that numerator divided by denominator reproduces the percentage within rounding. If the source figures do not agree, disclose the inconsistency and do not present an unverified denominator as established. Separate differing definitions and conflicting measurements rather than combining them. Before stating a numerical maximum, total, or share, check whether the retrieved passages disagree for the same metric and period. When a report summary and a chart or generated visual description disagree, state both values with their specific pages and explain that the discrepancy is unresolved; never silently replace the explicit summary with a chart reading. Generated retrieval notes are secondary to original source text. An inventory snapshot does not establish observed activity in a different period, and a chart or summary does not establish an unprovided raw-data calculation. State precisely what the available evidence can and cannot establish. When the requested inference is unsupported, keep the abstention concise: identify the missing observations or scope mismatch, and do not append unrelated aggregate figures from other periods.
`;

/** Keep category membership explicit instead of scattering it across item details. */
export function numberedCategoryGroupingRequirement(requestText: string): string {
  const asksForMembership = /\bwhich\b[\s\S]{0,100}\b(?:are|were|belong|fall)\b/iu.test(
    requestText,
  );
  const hasNumberedCollection =
    /\b(?:visits?|items?|steps?|stages?|sessions?|groups?|arms?|cohorts?)\b/iu.test(requestText);
  if (!asksForMembership || !hasNumberedCollection) return '';

  return '\nWhen answering which numbered items belong to each category, give a compact category summary with the complete grouped list before any item-by-item details (for example, "in-person visits are visits 1 and 7"). Keep the collection word and first number contiguous: write "visits 1 and 7", never "visits: 1 and 7". Do not make the reader reconstruct a category from separate bullets.\n';
}

/** Preserve short source labels whose negation can be lost by paraphrasing. */
export function namedComparisonLabelRequirement(requestText: string): string {
  if (
    !/\b(?:compare|compared|comparison|versus|vs\.?|regimens?|arms?|groups?)\b/iu.test(requestText)
  ) {
    return '';
  }
  return '\nWhen naming compared regimens, arms, or groups, preserve each label exactly as it appears in the evidence, including words such as "no", "without", or "placebo", and state the pair compactly as "X versus Y" before explaining it.\n';
}

/** Make compound evidence questions answer every requested field explicitly. */
export function evidenceCoverageRequirement(requestText: string): string {
  const requirements: string[] = [];
  if (/\b(?:objectives?|endpoints?)\b/iu.test(requestText)) {
    requirements.push(
      'List every main objective or endpoint named by the evidence using its source label; do not replace an outcome endpoint with only the assessment method used to measure it. When the same question also asks about a procedure or visit table, take objectives/endpoints from sections explicitly labeled Aim, Objective, or Outcome Measures, and use the table only for the schedule; never relabel table procedures, measurements, or specimen collections as intervention endpoints.',
    );
  }
  if (
    /\bsample[- ]?size\b/iu.test(requestText) &&
    /\bpower(?:ed)?\b|\bstatistical\s+power\b/iu.test(requestText)
  ) {
    requirements.push(
      'State both the sample size and the numeric statistical power (normally a percentage) explicitly. Keep power separate from alpha, p-values, and false-discovery-rate thresholds.',
    );
  }
  if (/\bjoin\s+keys?\b|\bkeys?\s+used\b/iu.test(requestText)) {
    requirements.push(
      'Name each join-key column explicitly in the prose answer using its exact schema label (for example, patient_id), not only a humanized phrase such as patient IDs.',
    );
  }
  if (/\bdashboard\b/iu.test(requestText)) {
    requirements.push(
      'Summarize every metric explicitly requested by the user in visible prose, including rates and missing-value counts; do not leave required headline values only on a later page of a paginated artifact.',
    );
  }
  if (requirements.length === 0) return '';
  return `\nCOMPOUND ANSWER CHECKLIST: ${requirements.join(' ')} Before finishing, verify that every field explicitly requested in the question appears in the answer.\n`;
}

/**
 * Guidelines for medical and scientific research queries:
 * Allows clean metrics, mermaid diagrams, KaTeX math, tabs, and embedded evidence figures,
 * while forbidding raw HTML/CSS tags or raw Python tuple/dict dumps.
 */
export const SCIENTIFIC_PRESENTATION_STYLE = `
For medical, clinical trial, and scientific research analysis:
- Present key metrics, comparisons, arm results, and endpoints cleanly:
  You may present key numeric comparisons (such as trial arms, hazard ratios, risk differences, or blood pressure changes) using a metrics block:
  \`\`\`metrics
  {
    "title": "Week 12 Mean SBP",
    "items": [
      {"label": "Cardiolex 10mg", "value": "141.6", "unit": "mmHg"},
      {"label": "Placebo", "value": "154.0", "unit": "mmHg"}
    ],
    "highlight": {"label": "Gap (Placebo - Cardiolex)", "value": "12.4", "unit": "mmHg"}
  }
  \`\`\`
- When illustrating clinical trial flow (e.g. CONSORT enrollment/allocation), study timelines, or biological pathways, you may use a mermaid block:
  \`\`\`mermaid
  graph TD
    Screened[Screened n=720] --> Randomized[Randomized n=600]
    Randomized --> ArmA[Cardiolex 10mg n=298]
    Randomized --> ArmB[Placebo n=302]
  \`\`\`
- For formulas, statistical tests, or p-values, use standard LaTeX ($inline$ or $$block$$).
- When multi-faceted comparisons are needed (e.g. Efficacy vs Safety vs Subgroups), you may organize them with tabs:
  \`\`\`tabs
  [
    {"label": "Efficacy", "content": "Analysis of primary endpoints..."},
    {"label": "Safety", "content": "Adverse events and tolerability..."}
  ]
  \`\`\`
- When an indexed document figure, plot, or image is returned by the evidence with an imageUrl or previewUrl, you can embed it directly as ![Figure title](imageUrl).
- Never output raw HTML or CSS tags.
- Never output raw Python tuples, unformatted dictionaries, or execution print traces into your answer. Explain statistical conclusions in natural language and clean metrics.
`;

export function sanitizeAssistantHistoryText(text: string): string {
  if (!text) return '';
  // 1. Convert metrics JSON to plain text summary
  let cleaned = text.replace(/```(?:metrics|stats|larkup-metrics)\s*([\s\S]*?)```/gi, (_m, raw) => {
    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed?.items) ? parsed.items : [];
      const lines: string[] = [];
      if (parsed?.title) lines.push(String(parsed.title));
      for (const item of items) {
        if (item?.label && item?.value !== undefined) {
          lines.push(`- ${item.label}: ${item.value}${item.unit ? ' ' + item.unit : ''}`);
        }
      }
      if (parsed?.highlight?.label && parsed?.highlight?.value !== undefined) {
        lines.push(
          `- ${parsed.highlight.label}: ${parsed.highlight.value}${parsed.highlight.unit ? ' ' + parsed.highlight.unit : ''}`,
        );
      }
      return lines.join('\n');
    } catch {
      return '';
    }
  });

  // 2. Convert tabs JSON to combined plain text
  cleaned = cleaned.replace(/```(?:tabs|larkup-tabs)\s*([\s\S]*?)```/gi, (_m, raw) => {
    try {
      const parsed = JSON.parse(raw);
      const tabs = Array.isArray(parsed) ? parsed : parsed?.tabs;
      if (Array.isArray(tabs)) {
        return tabs.map((t: any) => `${t.label || 'Tab'}:\n${t.content || ''}`).join('\n\n');
      }
    } catch {}
    return '';
  });

  // 3. Strip stray HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, '');

  return cleaned.trim();
}
