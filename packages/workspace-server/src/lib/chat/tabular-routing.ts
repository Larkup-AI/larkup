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

function normalizedRelationshipKey(value: string) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function isRelationshipKey(value: string) {
  const normalized = normalizedRelationshipKey(value);
  return (
    normalized.length >= 3 &&
    (normalized.endsWith('id') || normalized.endsWith('key') || normalized.endsWith('code'))
  );
}

export function tabularRelationships(datasets: TabularDatasetMeta[]) {
  const relationships: Array<{
    leftDatasetId: string;
    leftFileName: string;
    rightDatasetId: string;
    rightFileName: string;
    column: string;
  }> = [];
  for (let leftIndex = 0; leftIndex < datasets.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < datasets.length; rightIndex += 1) {
      const left = datasets[leftIndex];
      const right = datasets[rightIndex];
      for (const leftColumn of left.columns.filter((column) => isRelationshipKey(column.name))) {
        const rightColumn = right.columns.find(
          (column) =>
            isRelationshipKey(column.name) &&
            normalizedRelationshipKey(column.name) === normalizedRelationshipKey(leftColumn.name),
        );
        if (!rightColumn) continue;
        relationships.push({
          leftDatasetId: left.id,
          leftFileName: left.fileName,
          rightDatasetId: right.id,
          rightFileName: right.fileName,
          column: leftColumn.name,
        });
      }
    }
  }
  return relationships;
}

/**
 * Expand directly requested schemas through exact key relationships. Small
 * connected components are mounted whole so a planner cannot omit a bridge
 * table (for example an event -> visit -> subject path). Large workspaces stay
 * bounded to the directly relevant component frontier.
 */
export function tabularDatasetIdsForAnalysis(
  text: string,
  datasets: TabularDatasetMeta[],
  maximumDatasets = 12,
): string[] {
  const sourceSets = requiredTabularSourceSets(text, datasets);
  const seeds = new Set(sourceSets.flatMap((sources) => [...sources]));
  if (seeds.size === 0) return [];

  const neighbors = new Map(datasets.map((dataset) => [dataset.id, new Set<string>()]));
  for (const relationship of tabularRelationships(datasets)) {
    neighbors.get(relationship.leftDatasetId)?.add(relationship.rightDatasetId);
    neighbors.get(relationship.rightDatasetId)?.add(relationship.leftDatasetId);
  }

  const selected = new Set(seeds);
  const queue = [...seeds];
  while (queue.length > 0 && selected.size < maximumDatasets) {
    const current = queue.shift()!;
    for (const neighbor of neighbors.get(current) ?? []) {
      if (selected.has(neighbor)) continue;
      selected.add(neighbor);
      queue.push(neighbor);
      if (selected.size >= maximumDatasets) break;
    }
  }
  return datasets.filter((dataset) => selected.has(dataset.id)).map((dataset) => dataset.id);
}

/** Find the entity-level population table for a per-entity rate, using keys and cardinality. */
export function populationDatasetIdsForPerEntityRate(
  text: string,
  datasets: TabularDatasetMeta[],
  selectedIds: string[],
): string[] {
  const entity = text
    .match(
      /\bper\s+(?:randomi[sz]ed\s+)?(subject|patient|participant|person|individual|record)\b/iu,
    )?.[1]
    ?.toLocaleLowerCase();
  if (!entity || selectedIds.length === 0) return [];
  const entityKey = `${entity}id`;
  const selectedKeys = new Set(
    datasets
      .filter((dataset) => selectedIds.includes(dataset.id))
      .flatMap((dataset) =>
        dataset.columns
          .filter((column) => isRelationshipKey(column.name))
          .map((column) => normalizedRelationshipKey(column.name)),
      ),
  );
  const candidates = datasets
    .flatMap((dataset) => {
      const idColumn = dataset.columns.find(
        (column) => normalizedRelationshipKey(column.name) === entityKey,
      );
      if (
        !idColumn ||
        !dataset.columns.some((column) => {
          const key = normalizedRelationshipKey(column.name);
          return key !== entityKey && selectedKeys.has(key);
        })
      )
        return [];
      return [
        {
          id: dataset.id,
          uniqueness: dataset.rowCount > 0 ? idColumn.uniqueCount / dataset.rowCount : 0,
        },
      ];
    })
    .sort((left, right) => right.uniqueness - left.uniqueness);
  return candidates.length === 1 ||
    (candidates[0]?.uniqueness ?? 0) > (candidates[1]?.uniqueness ?? 0)
    ? [candidates[0].id]
    : [];
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

/** Mount every dataset whose exact visible filename is read by generated code. */
export function tabularDatasetIdsReferencedByCode(
  code: string,
  datasets: TabularDatasetMeta[],
): string[] {
  const normalizedCode = code.toLocaleLowerCase();
  return datasets
    .filter((dataset) => {
      const fileName = dataset.fileName.split(/[\\/]/).at(-1)?.toLocaleLowerCase();
      return Boolean(
        fileName &&
        (normalizedCode.includes(`'${fileName}'`) || normalizedCode.includes(`"${fileName}"`)),
      );
    })
    .map((dataset) => dataset.id);
}

/** Recover providers that serialize an ID array as one comma-delimited string. */
export function splitTabularDatasetReferences(references: string[]): string[] {
  return references
    .flatMap((reference) => reference.split(','))
    .map((reference) => reference.trim())
    .filter(Boolean);
}

/** Make empty integrity findings numerically explicit in grounded tool output. */
export function appendExplicitValidationZeroCounts(requestText: string, stdout: string): string {
  if (
    !/\b(?:validate|validation|duplicate|orphan|integrity|before\s+(?:enrollment|baseline))\b/iu.test(
      requestText,
    )
  ) {
    return stdout;
  }
  const counts = [
    ...stdout.matchAll(
      /['"]([^'"]*(?:duplicat|orphan|before[_ ]enrollment)[^'"]*)['"]\s*:\s*\[\s*\]/giu,
    ),
    ...stdout.matchAll(
      /^\s*['"]?([^:\n]*(?:duplicat|orphan|before[_ ]enrollment)[^:\n]*)['"]?\s*:\s*0(?:\.0+)?\s*$/gimu,
    ),
  ].map((match) => {
    const label = match[1].replaceAll('_', ' ').trim();
    return `${label}${/\bcount$/iu.test(label) ? '' : ' count'}: 0`;
  });
  if (counts.length === 0) return stdout;
  return `${stdout.trim()}\n${[...new Set(counts)].join('\n')}`;
}

/** Keep displayed rate/percentage evidence at the default one-decimal contract. */
export function normalizePercentagePrecisionInStdout(requestText: string, stdout: string) {
  if (
    !/\b(?:rate|incidence|percentage|proportion|per\s+(?:patient|subject|record|site))\b/iu.test(
      requestText,
    ) ||
    /\b\d+\s+decimal\s+places?\b/iu.test(requestText)
  ) {
    return stdout;
  }
  const displayValues = [
    ...new Set(
      [...stdout.matchAll(/(?<![\w.])-?\d+\.\d{2,}(?![\w.])/gu)].map((match) =>
        Number(match[0]).toFixed(1),
      ),
    ),
  ];
  return displayValues.length > 0
    ? `${stdout.trim()}\ndisplay percentage values (1 decimal): ${displayValues.join(', ')}`
    : stdout;
}

/**
 * Recover mistyped opaque IDs only when exact filenames in the generated code
 * account for every unavailable source. The one-to-one requirement avoids
 * guessing among unrelated uploads.
 */
export function repairUnavailableTabularDatasetReferences(
  references: string[],
  code: string,
  datasets: TabularDatasetMeta[],
): string[] {
  const availableIds = new Set(datasets.map((dataset) => dataset.id));
  const missing = references.filter((reference) => !availableIds.has(reference));
  if (missing.length === 0) return references;

  const selected = new Set(references.filter((reference) => availableIds.has(reference)));
  const normalizedCode = code.toLocaleLowerCase();
  const replacements = datasets.filter((dataset) => {
    if (selected.has(dataset.id)) return false;
    const fileName = dataset.fileName.split(/[\\/]/).at(-1)?.toLocaleLowerCase();
    return Boolean(
      fileName &&
      (normalizedCode.includes(`'${fileName}'`) || normalizedCode.includes(`"${fileName}"`)),
    );
  });
  if (replacements.length !== missing.length) return references;

  let replacementIndex = 0;
  return references.map((reference) =>
    availableIds.has(reference) ? reference : replacements[replacementIndex++].id,
  );
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
 * A related PDF may explain the study but cannot replace the joins requested
 * across the indexed tables. Keep that PDF from short-circuiting analysis.
 */
export function shouldPrioritizeTabularAnalysisBeforePdf(input: {
  hasTabularData: boolean;
  tabularQuestion: boolean;
  requiresSandbox: boolean;
  requiresMultiDatasetAnalysis: boolean;
}): boolean {
  return (
    input.hasTabularData &&
    input.tabularQuestion &&
    (input.requiresSandbox || input.requiresMultiDatasetAnalysis)
  );
}

/**
 * Some questions require a document fact and a table-derived calculation in
 * the same answer. Treat the document reference as evidence, not an excuse to
 * skip the structured-data path (or vice versa). The wording is deliberately
 * source-generic: it recognizes document objects and reports rather than a
 * particular study, filename, or domain vocabulary.
 */
export function requiresPdfAndTabularEvidence(input: {
  text: string;
  hasTabularData: boolean;
  tabularQuestion: boolean;
}): boolean {
  if (!input.hasTabularData || !input.tabularQuestion) return false;
  return /\b(?:fig(?:ure)?\s*(?:\d+|[ivx]+)|table\s*(?:\d+|[ivx]+)|diagram|appendix|equation|report|protocol|paper|document|pdf)\b/iu.test(
    input.text,
  );
}

/** A chart-derived statistic needs its PDF source even when a CSV is available. */
export function requiresPdfStatisticSource(text: string): boolean {
  return /\b(?:kaplan[ -]meier|survival\s+curve|at[ -]risk(?:\s+table)?)\b/iu.test(text);
}

/** A prior result table is valid input only when the current question does not require fresh files. */
export function shouldUseRecentAnalysisTable(
  text: string,
  datasets: TabularDatasetMeta[],
  hasRecentAnalysisTable: boolean,
) {
  return hasRecentAnalysisTable && !requiresMultiDatasetAnalysis(text, datasets);
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
    /\b(?:join|correlat(?:e|ion)|regression|cluster(?:ing)?|forecast(?:ing)?|statistical|dashboard|complete\s+cases?|confidence\s+interval|sandbox|python|matplotlib|seaborn|scikit(?:-learn)?|custom\s+(?:analysis|chart|visuali[sz]ation)|across\s+(?:sheets?|tables?|datasets?|files?)|between\s+(?:sheets?|tables?|datasets?|files?))\b/i.test(
      text,
    ) ||
    // Integrity validation is exhaustive by definition: a bounded grouped
    // query cannot prove the absence of duplicates, orphans, or invalid date
    // relationships across related tables.
    /\bvalidat(?:e|ion)\b[\s\S]{0,220}\b(?:primary[- ]?keys?|foreign[- ]?keys?|orphans?|duplicates?|before\s+enrollment)\b/i.test(
      text,
    ) ||
    // A ranked entity rate normally needs a fact table for its numerator and
    // denominator plus a dimension table for a human-readable entity name.
    /\bwhich\b[\s\S]{0,100}\b(?:highest|lowest|largest|smallest)\b[\s\S]{0,100}\b(?:rates?|percentages?)\b/i.test(
      text,
    ) ||
    // Longitudinal baseline-versus-follow-up comparisons usually require a
    // visit sequence table in addition to the measured facts.
    /\bvisit\s*(?:1|one)\b[\s\S]{0,100}\b(?:later|subsequent|follow-up)\s+visits?\b/i.test(text) ||
    // A severity chart grouped by a cohort/arm cannot be produced from an
    // event table that only carries subject keys; use the relationship graph.
    /\b(?:chart|graph|plot|visuali[sz])\b[\s\S]{0,160}\b(?:severity|serious|grade)\b[\s\S]{0,100}\bby\s+(?:arm|group|cohort)\b/i.test(
      text,
    ) ||
    /\b(?:severity|serious|grade)\b[\s\S]{0,100}\b(?:chart|graph|plot|visuali[sz])\b[\s\S]{0,100}\bby\s+(?:arm|group|cohort)\b/i.test(
      text,
    ) ||
    // Comparative metrics need reproducible numerators and denominators for
    // each group. A single bounded table query is not sufficient evidence for
    // a risk difference, relative risk, or per-entity rate.
    /\b(?:absolute\s+)?risk\s+(?:difference|ratio)|relative\s+risk|odds\s+ratio|\bper\s+(?:randomi[sz]ed\s+)?(?:subject|patient|participant|site)\b/i.test(
      text,
    ) ||
    // A charted summary that asks for several measures for every cohort is a
    // composite report, not a single aggregation.
    /\b(?:summary|report|dashboard)\b[\s\S]{0,100}\b(?:both|each|all)\b[\s\S]{0,100}\b(?:trials?|groups?|cohorts?)\b[\s\S]{0,180}\b(?:chart|graph|plot|visuali[sz])\b/i.test(
      text,
    ) ||
    /\b(?:both|each|all)\b[\s\S]{0,100}\b(?:trials?|groups?|cohorts?)\b[\s\S]{0,180}\b(?:chart|graph|plot|visuali[sz])\b/i.test(
      text,
    ) ||
    requestsLongAnalysisArtifact(text)
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

export function analysisValidationRequirements(text: string) {
  const requirements: string[] = [];
  if (
    /\b(?:risk|rate|ratio|incidence|percentage|proportion|per\s+(?:patient|subject|record|site))\b/iu.test(
      text,
    )
  ) {
    requirements.push(
      'derive each numerator and denominator separately from the requested population before filtering or joining, then print each numerator and denominator with its source label; never use only matched rows as the denominator unless the request explicitly says so; unless the user requests another precision, display percentages rounded to one decimal place while keeping unrounded values for ranking and calculations',
      'for incidence, derive the denominator from the complete subject or population table after applying any requested population flag; never derive it from the event table because subjects without events are absent there',
    );
  }
  if (/\b(?:join|across|between|overlap|orphan|foreign\s+key)\b/iu.test(text)) {
    requirements.push(
      'validate join keys, unmatched rows, and one to one or one to many cardinality before aggregation',
    );
  }
  if (
    /\b(?:validate|validation|duplicate|orphan|integrity|before\s+(?:enrollment|baseline))\b/iu.test(
      text,
    )
  ) {
    requirements.push(
      'report every validation result with its label and an explicit numeric zero when no violations exist; never replace a zero count with only "none" or omit it',
    );
  }
  if (/\b(?:chart|graph|plot|visuali[sz])\b/iu.test(text)) {
    requirements.push(
      'assert that plotted grouping and measures exactly match the requested chart intent',
    );
  }
  if (/\b(?:pdf|report|fig(?:ure)?\s*\d+|table\s*\d+|diagram)\b/iu.test(text)) {
    requirements.push(
      'when combining document facts with tabular calculations, transcribe the needed document values from the inspected source first, keep row and column labels paired, and show the exact source value and formula; never substitute a similarly named CSV field for a document count',
    );
  }
  if (/\b(?:trials?|sites?|patients?|subjects?)\b/iu.test(text)) {
    requirements.push(
      'when a dimension table provides both an internal identifier and a human-readable code or name, join and report the human-readable code or name alongside the internal identifier',
    );
  }
  if (
    /\bvisit\s*(?:1|one)\b[\s\S]{0,80}\b(?:later|subsequent|follow-up)\s+visits?\b/iu.test(text)
  ) {
    requirements.push(
      "join to the visit sequence or visit-number column and group on that value; never interpret a globally unique visit ID equal to 1 as every patient's first visit",
    );
  }
  return requirements.length > 0
    ? ` Validation requirements: ${requirements.join('; ')}. Include source filenames, key columns, and the calculation formula in the usable output.`
    : '';
}

/** Surface scalar population counts calculated by Python so final prose can use verified denominators. */
export function withAnalysisNumericProvenance(code: string, question: string): string {
  if (
    !/\b(?:risk|rate|ratio|incidence|percentage|proportion|per\s+(?:patient|subject|record|site))\b/iu.test(
      question,
    )
  ) {
    return code;
  }
  return `${code}\n\n# Report named numeric population values used in rate and risk calculations.\nimport numbers as _larkup_numbers\nimport re as _larkup_re\n_larkup_provenance = [(name, value) for name, value in list(globals().items()) if not name.startswith('_') and _larkup_re.search(r'(?:^|_)(?:n|count|size|total|denom(?:inator)?|population)(?:_|$)', name, _larkup_re.I) and isinstance(value, _larkup_numbers.Number) and not isinstance(value, bool)]\nfor _larkup_name, _larkup_value in _larkup_provenance[:24]:\n    print(f"Verified calculation input {_larkup_name}: {_larkup_value}")\n`;
}

/** Reject successful-looking code that uses a known invalid aggregation level. */
export function analysisCodeValidationError(
  text: string,
  code: string,
  options: {
    requiresMountedRead?: boolean;
    requiredPopulationFiles?: string[];
    mountedDatasetSchemas?: Array<{ fileName: string; columns: string[] }>;
  } = {},
): string | undefined {
  for (const dataset of options.mountedDatasetSchemas ?? []) {
    const literalColumns = dataset.columns.filter((column) => {
      const escaped = column.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      return new RegExp(`["']${escaped}["']\\s*:\\s*\\[`, 'u').test(code);
    });
    if (literalColumns.length >= 2) {
      return `Invalid tabular evidence: the code reconstructs rows from uploaded ${dataset.fileName} as literal column arrays. Read the mounted file instead and derive those fields from its rows.`;
    }
  }
  const missingPopulationFile = options.requiredPopulationFiles?.find(
    (fileName) =>
      !code.toLocaleLowerCase().includes(fileName.toLocaleLowerCase()) &&
      !/\bdatasets\.json\b/iu.test(code),
  );
  if (missingPopulationFile) {
    return `Invalid rate denominator: read the mounted population dataset ${missingPopulationFile} and count distinct entities by the requested group before dividing. Do not infer a population from another table or a literal mapping.`;
  }
  const asksForUploadedTable =
    options.requiresMountedRead === true ||
    /\.csv\b|\b(?:spreadsheet|excel|dataset|table)\b/iu.test(text);
  if (
    /\bper\s+(?:randomi[sz]ed\s+)?(?:subject|patient|participant|record|site)\b/iu.test(text) &&
    /(?:^|_)per_(?:randomi[sz]ed_)?(?:subject|patient|participant|record|site)\b/iu.test(code) &&
    !code
      .split('\n')
      .some((line) => !line.trimStart().startsWith('#') && /(?<!\/)\/(?!\/)|\.div\s*\(/u.test(line))
  ) {
    return 'Invalid per-entity rate: the generated code never divides the source count by the matching population denominator. Compute numerator / denominator explicitly.';
  }
  if (/\bpatients?\s+with\s+any\s+(?:adverse\s+events?|AE)\b/iu.test(text)) {
    const eventRowFlag = code.match(
      /\b([A-Za-z_]\w*)\s*\[\s*['"]has_ae['"]\s*\]\s*=\s*[^\n]*(?:event|ae_id)[^\n]*\.(?:notnull|notna)\s*\(/iu,
    )?.[1];
    const sumsFlagFromSameFrame = Boolean(
      eventRowFlag &&
      new RegExp(
        `\\b${eventRowFlag}\\.groupby\\s*\\([\\s\\S]{0,300}patients?_with_(?:any_)?ae\\s*=\\s*\\(\\s*['"]has_ae['"]\\s*,\\s*['"]sum['"]`,
        'iu',
      ).test(code),
    );
    const outerMergeSizePretendsToBeEventCount =
      /\bmerge\s*\([^\n]*\bhow\s*=\s*['"](?:left|right|outer)['"][^\n]*\)/iu.test(code) &&
      /\.groupby\s*\([^\n]*patient_id[^\n]*\)\.size\s*\(\)\.reset_index\s*\(\s*name\s*=\s*['"]ae_count['"]\s*\)/iu.test(
        code,
      ) &&
      /\[\s*['"]has_ae['"]\s*\]\s*=\s*[^\n]*\[\s*['"]ae_count['"]\s*\]\s*>\s*0/iu.test(code);
    if (sumsFlagFromSameFrame || outerMergeSizePretendsToBeEventCount) {
      return 'Invalid patient incidence numerator: summing an event-row flag counts one patient repeatedly when they have multiple events. Count distinct patient IDs with at least one event.';
    }
  }

  if (
    /\bvisit\s*(?:1|one)\b[\s\S]{0,80}\b(?:later|subsequent|follow-up)\s+visits?\b/iu.test(text) &&
    (/(?:\[\s*['"]visit_id['"]\s*\]|\.visit_id)\s*(?:==|!=|<=|>=|<|>)\s*1\b/u.test(code) ||
      (/\[\s*['"]visit_id['"]\s*\]/u.test(code) &&
        /\b(?:if|where|map|lambda)\b[^\n]{0,120}==\s*1\b/u.test(code) &&
        !/\bvisit_(?:number|sequence|num)\b/iu.test(code)))
  ) {
    return 'Invalid visit grouping: visit_id is a relationship key, not the per-subject visit sequence. Join the visit table and compare its visit-number/sequence column to 1.';
  }

  if (
    /\b(?:percent(?:age)?|incidence|proportion)\b[\s\S]{0,100}\bsafety\s+(?:subjects?|population)\b/iu.test(
      text,
    )
  ) {
    const taintedByEventJoin = new Set<string>();
    const assignments = code.split('\n').flatMap((line) => {
      const match = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.+)$/u);
      return match ? [{ name: match[1], expression: match[2] }] : [];
    });
    for (let pass = 0; pass < assignments.length; pass += 1) {
      let changed = false;
      for (const assignment of assignments) {
        const directlyMerged = /(?:\bpd\.)?merge\s*\(|\.merge\s*\(/u.test(assignment.expression);
        const derivedFromMerge = [...taintedByEventJoin].some((name) =>
          new RegExp(`\\b${name}\\b`, 'u').test(assignment.expression),
        );
        if ((directlyMerged || derivedFromMerge) && !taintedByEventJoin.has(assignment.name)) {
          taintedByEventJoin.add(assignment.name);
          changed = true;
        }
      }
      if (!changed) break;
    }
    for (const assignment of assignments) {
      const groupedReceiver = assignment.expression.match(/^([A-Za-z_]\w*)\.groupby\s*\(/u)?.[1];
      if (
        groupedReceiver &&
        taintedByEventJoin.has(groupedReceiver) &&
        /\.mean\s*\(/u.test(assignment.expression)
      ) {
        return 'Invalid subject incidence: averaging a flag over event-joined rows weights subjects by their number of events. Count distinct subjects with an event and divide by distinct safety subjects from the complete subject table.';
      }
      if (!/(?:denom|population|pop|sizes?|totals?)/iu.test(assignment.name)) continue;
      if (groupedReceiver && taintedByEventJoin.has(groupedReceiver)) {
        return 'Invalid incidence denominator: derive the safety-population arm sizes from the complete subject table before joining to the event table; event-joined rows exclude subjects without events.';
      }
    }
  }
  if (
    asksForUploadedTable &&
    /\b(?:StringIO|BytesIO)\s*\(|\b(?:pd|pandas)\s*\.\s*read_csv\s*\(\s*(?:r?["']{3}|[A-Za-z_]\w*_data\b)/u.test(
      code,
    )
  ) {
    return 'Invalid tabular evidence: the code embeds or reconstructs a dataset instead of reading the mounted uploaded file. Read the selected data.csv or datasets.json files and derive every CSV value from those rows.';
  }
  if (
    asksForUploadedTable &&
    (options.requiresMountedRead || /\b(?:pd|pandas)\s*\.\s*DataFrame\s*\(/u.test(code)) &&
    !/\b(?:read_csv|read_excel|read_parquet|DictReader)\s*\(/u.test(code)
  ) {
    return 'Invalid tabular evidence: the code did not read a mounted uploaded dataset. Read data.csv or the files listed in datasets.json before calculating table-derived values.';
  }
  return undefined;
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

/** Stop the stream on repeated failed analysis instead of inviting prose that
 * could turn an incomplete calculation into a confident final answer. */
export function hasExhaustedAnalysisAttempts(
  steps: Array<{ toolResults?: readonly unknown[] }>,
  maximumAttempts = 3,
) {
  let failedAttempts = 0;
  for (const step of steps) {
    for (const result of step.toolResults ?? []) {
      if (!result || typeof result !== 'object') continue;
      const toolResult = result as { toolName?: unknown; output?: unknown };
      if (toolResult.toolName !== 'executeAnalysis') continue;
      const wrapped = toolResult.output as { value?: unknown } | undefined;
      const output = (
        wrapped && typeof wrapped === 'object' && 'value' in wrapped ? wrapped.value : wrapped
      ) as { exitCode?: unknown } | undefined;
      if (output?.exitCode === 0) failedAttempts = 0;
      else if (typeof output?.exitCode === 'number') failedAttempts += 1;
    }
  }
  return failedAttempts >= maximumAttempts;
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
    /\b(?:spreadsheet|excel|csv|worksheet|sheet|dataset|data document|row|column|filter|sort|group(?:ed|ing)?|aggregate|average|median|total|sum|count|highest|lowest|largest|smallest|maximum|minimum|trend|distribution|primary\s+key|foreign\s+key|orphan(?:ed)?|duplicates?)\b/.test(
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
