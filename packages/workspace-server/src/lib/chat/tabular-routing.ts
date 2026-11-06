import type { TabularDatasetMeta } from '@larkup/core/tabular-store';

const DATASET_NAME_STOP_WORDS = new Set(['data', 'dataset', 'table', 'sheet', 'file']);

function routingTerms(value: string) {
  return (value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .map((term) => (term.length > 4 && term.endsWith('s') ? term.slice(0, -1) : term))
    .filter((term) => term.length >= 3);
}

function questionMentionsColumn(questionTerms: Set<string>, column: string) {
  const terms = routingTerms(column).filter((term) => term !== 'id');
  return terms.length > 0 && terms.every((term) => questionTerms.has(term));
}

function requiredTabularSourceSets(text: string, datasets: TabularDatasetMeta[]) {
  const questionTerms = new Set(routingTerms(text));
  const requiredSources: Array<Set<string>> = [];
  const mentionedColumns = new Set<string>();
  for (const dataset of datasets) {
    for (const column of dataset.columns) {
      if (questionMentionsColumn(questionTerms, column.name)) {
        mentionedColumns.add(column.name.toLocaleLowerCase());
      }
    }
  }
  const mostSpecificMentionedColumns = [...mentionedColumns].filter((column) => {
    const terms = new Set(routingTerms(column).filter((term) => term !== 'id'));
    return ![...mentionedColumns].some((candidate) => {
      if (candidate === column) return false;
      const candidateTerms = new Set(routingTerms(candidate).filter((term) => term !== 'id'));
      return (
        candidateTerms.size > terms.size && [...terms].every((term) => candidateTerms.has(term))
      );
    });
  });
  for (const column of mostSpecificMentionedColumns) {
    requiredSources.push(
      new Set(
        datasets
          .filter((dataset) =>
            dataset.columns.some((candidate) => candidate.name.toLocaleLowerCase() === column),
          )
          .map((dataset) => dataset.id),
      ),
    );
  }
  for (const dataset of datasets) {
    const fileTerms = routingTerms(dataset.fileName.replace(/\.[^.]+$/, '')).filter(
      (term) => !DATASET_NAME_STOP_WORDS.has(term),
    );
    if (
      fileTerms.length > 0 &&
      fileTerms.every((term) => term.length < 4 || questionTerms.has(term))
    ) {
      requiredSources.push(new Set([dataset.id]));
    }
  }
  return requiredSources;
}

/** Return only unambiguous schemas named by the question. */
export function tabularDatasetIdsRequiredByQuestion(
  text: string,
  datasets: TabularDatasetMeta[],
): string[] {
  return [
    ...new Set(
      requiredTabularSourceSets(text, datasets).flatMap((sources) =>
        sources.size === 1 ? [...sources] : [],
      ),
    ),
  ];
}

/**
 * Accept the stable ID contract while recovering exact visible filenames that
 * a model may copy from the dataset manifest into the datasetIds field.
 * Ambiguous names are deliberately left unresolved.
 */
export function resolveTabularDatasetReferences(
  references: string[],
  datasets: TabularDatasetMeta[],
): string[] {
  const byReference = new Map<string, Set<string>>();
  const add = (reference: string, id: string) => {
    const normalized = reference.trim().toLocaleLowerCase();
    if (!normalized) return;
    const ids = byReference.get(normalized) ?? new Set<string>();
    ids.add(id);
    byReference.set(normalized, ids);
  };
  for (const dataset of datasets) {
    const fileName = dataset.fileName.split(/[\\/]/).at(-1) ?? dataset.fileName;
    add(dataset.id, dataset.id);
    add(fileName, dataset.id);
    add(fileName.replace(/\.[^.]+$/, ''), dataset.id);
  }
  return references.map((reference) => {
    const fileName = reference.trim().split(/[\\/]/).at(-1) ?? reference.trim();
    const candidates = [reference.trim(), fileName, fileName.replace(/\.[^.]+$/, '')];
    for (const candidate of candidates) {
      const ids = byReference.get(candidate.toLocaleLowerCase());
      if (ids?.size === 1) return [...ids][0];
    }
    return reference;
  });
}

/**
 * Detect questions whose requested concepts cannot be satisfied by one
 * indexed table. This is schema-led rather than domain-led: filenames and
 * column names provide the evidence that multiple related sources are needed.
 */
export function requiresMultiDatasetAnalysis(
  text: string,
  datasets: TabularDatasetMeta[],
): boolean {
  if (datasets.length < 2) return false;
  const requiredSources = requiredTabularSourceSets(text, datasets);

  if (requiredSources.length < 2) return false;
  const commonSources = new Set(requiredSources[0]);
  for (const sources of requiredSources.slice(1)) {
    for (const source of commonSources) if (!sources.has(source)) commonSources.delete(source);
  }
  return commonSources.size === 0;
}

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
    // The first evidence tool has already returned authoritative rows (and,
    // for chart requests, queryTabularData has attached a normalized chart).
    // Re-exposing presentation and analysis tools here lets some models emit
    // a second, empty chart call or repeat the analysis instead of answering.
    return { toolChoice: 'none' as const, activeTools: [] };
  }
  return { toolChoice: 'none' as const, activeTools: [] };
}

/** Stop once the host has attached a renderable chart to authoritative rows. */
export function hasCompletedTabularVisualizationStep(
  steps: Array<{
    toolResults?: readonly unknown[];
  }>,
) {
  const lastStep = steps.at(-1);
  return Boolean(
    lastStep?.toolResults?.some((result) => {
      if (!result || typeof result !== 'object' || !('toolName' in result)) return false;
      if ((result as { toolName?: unknown }).toolName !== 'queryTabularData') return false;
      const output = (result as { output?: unknown }).output;
      return Boolean(
        output &&
        typeof output === 'object' &&
        'visualization' in output &&
        (output as { visualization?: unknown }).visualization,
      );
    }),
  );
}

/** Stop after a validated long artifact; the rendered tool result is the answer. */
export function hasCompletedLongAnalysisStep(
  steps: Array<{
    toolResults?: readonly unknown[];
  }>,
) {
  const lastStep = steps.at(-1);
  return Boolean(
    lastStep?.toolResults?.some((result) => {
      if (!result || typeof result !== 'object' || !('toolName' in result)) return false;
      if ((result as { toolName?: unknown }).toolName !== 'executeAnalysis') return false;
      const rawOutput = (result as { output?: unknown }).output;
      const output =
        rawOutput && typeof rawOutput === 'object' && 'value' in rawOutput
          ? (rawOutput as { value?: unknown }).value
          : rawOutput;
      if (!output || typeof output !== 'object') return false;
      const analysis = output as {
        exitCode?: unknown;
        presentation?: { complete?: unknown };
      };
      return analysis.exitCode === 0 && analysis.presentation?.complete === true;
    }),
  );
}

/**
 * Identify requests whose answer requires an out-of-core calculation rather
 * than a single structured table query. This is phrased around analytical
 * operations, so it works for any workbook and does not depend on sheet or
 * column names.
 */
export function requiresTabularSandbox(text: string): boolean {
  return (
    /\b(?:join|correlat(?:e|ion)|regression|cluster(?:ing)?|forecast(?:ing)?|statistical|sandbox|python|matplotlib|seaborn|scikit(?:-learn)?|custom\s+(?:analysis|chart|visuali[sz]ation)|across\s+(?:sheets?|tables?|datasets?|files?)|between\s+(?:sheets?|tables?|datasets?|files?))\b/i.test(
      text,
    ) || requestsLongAnalysisArtifact(text)
  );
}

/**
 * Long per-record transformations cannot be completed safely as streamed prose:
 * the model will eventually hit its output ceiling and a later "continue" loses
 * global constraints. Route these through one sandbox run and a paged artifact.
 */
export function requestsLongAnalysisArtifact(text: string): boolean {
  const hasManyTargets =
    /\bfor\s+(?:the\s+)?(?:first|last|top)\s+\d+\b|\bfor\s+(?:each|every|all)\b|\b(?:each|every|all)\s+(?:of\s+)?(?:the\s+)?(?:people|participants?|rows?|records?|entries|documents?|items?|responses?)\b/i.test(
      text,
    );
  const transformsEachTarget =
    /\b(?:match(?:es|ed|ing)?|recommend(?:ation|ations|ed|ing)?|count(?:ed|ing|s)?|calculat(?:e|ed|es|ing|ion)|aggregat(?:e|ed|es|ing|ion)|explain(?:ed|ing|s)?|summari[sz](?:e|ed|es|ing|ation)|profile(?:d|s|ing)?|assess(?:ed|ment|ments|ing)?|evaluat(?:e|ed|es|ing|ion)|classif(?:y|ied|ies|ication)|score(?:d|s|ing)?|rewrite|generate\s+(?:a\s+)?(?:description|report|answer))\b/i.test(
      text,
    );
  return hasManyTargets && transformsEachTarget;
}

/** Preserve explicit batch sizes for sandbox artifacts (larger than chat prose limits). */
export function requestedLongAnalysisItemCount(
  text: string,
  availableItems?: number,
): number | undefined {
  const match = text.match(
    /\b(?:first|last|top)\s+(\d{1,5})\b|\bfor\s+(\d{1,5})\s+(?:people|participants?|rows?|records?|entries|documents?|items?|responses?)\b|\b(?:listing|contains?|has|with)\s+(\d{1,5})\s+(?:people|participants?|rows?|records?|entries|documents?|items?|responses?)\b/i,
  );
  const value = Number(match?.[1] ?? match?.[2] ?? match?.[3]);
  if (Number.isInteger(value) && value > 0) return Math.min(value, 5_000);
  if (
    Number.isInteger(availableItems) &&
    availableItems! > 0 &&
    /\b(?:for\s+(?:each|every|all)|(?:each|every|all)\s+(?:of\s+)?(?:the\s+)?(?:people|participants?|rows?|records?|entries|documents?|items?|responses?))\b/i.test(
      text,
    )
  ) {
    return Math.min(availableItems!, 5_000);
  }
  return undefined;
}

/** Use a consistent capable code planner for deep artifacts across selectable chat models. */
export function tabularToolPlannerModel(requiresSandbox: boolean) {
  return requiresSandbox ? 'openai/gpt-4.1-mini' : 'openai/gpt-4o-mini';
}

export function supportsStableTabularPlanner(provider: string) {
  return provider === 'vercel_ai_gateway' || provider === 'openai';
}

/** Allow a bounded repair attempt when sandbox execution or validation failed. */
export function latestAnalysisAttemptFailed(messages: unknown[]) {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex] as { content?: unknown } | undefined;
    if (!Array.isArray(message?.content)) continue;
    for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.content[partIndex] as
        { type?: unknown; toolName?: unknown; output?: unknown } | undefined;
      if (part?.type !== 'tool-result' || part.toolName !== 'executeAnalysis') continue;
      const wrappedOutput = part.output as { value?: unknown } | undefined;
      const output = (
        wrappedOutput && typeof wrappedOutput === 'object' && 'value' in wrappedOutput
          ? wrappedOutput.value
          : wrappedOutput
      ) as { exitCode?: unknown } | undefined;
      return typeof output?.exitCode === 'number' && output.exitCode !== 0;
    }
  }
  return false;
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
    /\b(?:spreadsheet|excel|csv|worksheet|sheet|dataset|data document|row|column|filter|sort|group(?:ed|ing)?|aggregate|average|median|total|sum|count|highest|lowest|largest|smallest|maximum|minimum|trend|distribution)\b/.test(
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
