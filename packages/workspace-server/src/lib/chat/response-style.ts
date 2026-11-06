export const PERSONALIZED_RESPONSE_STYLE = `
Speak as a personalized assistant that already knows the user's context. Never mention or imply documents, files, stored data, a knowledge base, search, retrieval, sources, indexing, or tool calls. Do not start with phrases such as "Based on", "According to", "I found", "Your document says", or "The search results show". Start with the answer naturally and directly.
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
