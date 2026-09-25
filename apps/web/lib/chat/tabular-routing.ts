/**
 * Route ordinary sheet questions through the structured query engine, while
 * sending explicit joins and advanced analytics to the sandbox. This keeps
 * common Excel/CSV questions independent from local Python availability.
 */
export function tabularToolsForStep(input: {
  stepNumber: number;
  toolNames: string[];
  requiresSandbox?: boolean;
}) {
  if (input.stepNumber === 0) {
    if (input.requiresSandbox && input.toolNames.includes('executeAnalysis')) {
      return {
        toolChoice: { type: 'tool' as const, toolName: 'executeAnalysis' },
        activeTools: ['executeAnalysis'],
      };
    }
    return {
      toolChoice: { type: 'tool' as const, toolName: 'queryTabularData' },
      activeTools: ['queryTabularData'],
    };
  }
  if (input.stepNumber === 1) {
    if (input.requiresSandbox && input.toolNames.includes('executeAnalysis')) {
      return {
        toolChoice: { type: 'tool' as const, toolName: 'executeAnalysis' },
        activeTools: ['executeAnalysis'],
      };
    }
    return {
      activeTools: input.toolNames.filter((name) => name !== 'webSearch'),
    };
  }
  return { toolChoice: 'none' as const, activeTools: [] };
}

/**
 * Identify requests whose answer requires an out-of-core calculation rather
 * than a single structured table query. This is phrased around analytical
 * operations, so it works for any workbook and does not depend on sheet or
 * column names.
 */
export function requiresTabularSandbox(text: string): boolean {
  return /\b(?:join|correlat(?:e|ion)|regression|cluster(?:ing)?|forecast(?:ing)?|statistical|sandbox|python|matplotlib|seaborn|scikit(?:-learn)?|custom\s+(?:analysis|chart|visuali[sz]ation)|across\s+(?:sheets?|tables?|datasets?|files?)|between\s+(?:sheets?|tables?|datasets?|files?))\b/i.test(
    text,
  );
}

/**
 * A workspace can contain spreadsheets alongside PDFs, media, and notes.
 * Only force the table path when the wording actually asks for tabular facts;
 * otherwise normal source retrieval remains free to select the right modality.
 */
export function isLikelyTabularQuestion(input: {
  text: string;
  columnNames: string[];
  datasetNames: string[];
}) {
  const text = input.text.trim().toLocaleLowerCase();
  if (!text) return false;
  if (
    /\b(?:spreadsheet|excel|csv|worksheet|sheet|dataset|row|column|filter|sort|group(?:ed|ing)?|aggregate|average|median|total|sum|count|highest|lowest|largest|smallest|maximum|minimum|trend|distribution)\b/.test(
      text,
    ) ||
    /\b(?:arithmetic|geometric|weighted)\s+mean\b|\bmean\s+(?:of|for|by)\b/.test(text)
  ) {
    return true;
  }

  // “Put it in a table” describes the requested answer format, not the
  // source modality. Treat table as tabular only when the surrounding words
  // make a data table explicit, so a media or document question can still
  // retrieve its own source in a mixed workspace.
  if (
    /\b(?:data|database|pivot|lookup)\s+table\b|\btable\s+(?:data|rows?|columns?|schema|lookup)\b/.test(
      text,
    )
  ) {
    return true;
  }

  const mentionsDataset = input.datasetNames.some((name) => {
    const stem = name
      .replace(/\.(?:csv|xlsx|xls|json)$/i, '')
      .trim()
      .toLocaleLowerCase();
    return stem.length >= 3 && text.includes(stem);
  });
  if (mentionsDataset) return true;

  return input.columnNames.some((column) => {
    const normalized = column.trim().toLocaleLowerCase();
    if (normalized.length >= 4 && text.includes(normalized)) return true;
    const terms = normalized.match(/[\p{L}\p{N}_]+/gu) ?? [];
    const matchedTerms = terms.filter((term) => term.length >= 4 && text.includes(term));
    if (matchedTerms.length >= 2) return true;

    // Metrics in real workbooks often have long headers while the user asks
    // with one distinctive word. A sufficiently specific header token is
    // enough to choose the exact table tool without relying on dataset- or
    // domain-specific routing rules.
    return matchedTerms.some((term) => term.length >= 6);
  });
}
