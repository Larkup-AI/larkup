/** Paging indexed evidence is separate from paid inspection/tool-step budgets. */
export async function collectEvidencePages(query, { maxPages = 64, onPage = () => {} } = {}) {
  const pages = [], seen = new Set();
  const budget = Number.isInteger(maxPages) && maxPages > 0 ? Math.min(256, maxPages) : 64;
  let cursor;
  for (let page = 0; page < budget; page++) {
    const key = cursor ?? 0;
    if (seen.has(key)) return { success: false, toolExecutionValid: false, error: 'Evidence pagination repeated a cursor.', pages };
    seen.add(key);
    onPage(cursor);
    const result = await query(cursor);
    pages.push(result);
    if (!result.success) return { success: false, toolExecutionValid: false, error: result.error ?? 'Evidence action failed.', pages };
    if (!result.continuation?.hasMore) return { success: true, toolExecutionValid: true, pages };
    cursor = result.continuation.nextCursor;
    if (cursor === undefined || cursor === null) return { success: false, toolExecutionValid: false, error: 'Evidence pagination omitted its cursor.', pages };
  }
  return { success: false, toolExecutionValid: false, error: 'Evidence paging budget exhausted; coverage is unresolved.', pages };
}
