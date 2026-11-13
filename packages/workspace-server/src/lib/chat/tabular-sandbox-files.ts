import type { TabularDataset } from '@larkup/core/tabular-store';

export type TabularSandboxFile = { name: string; content: string };

export type TabularSandboxManifest = {
  datasets: Array<{
    id: string;
    fileName: string;
    file: string;
    rowCount: number;
    columns: string[];
  }>;
  relationships: Array<{
    leftDatasetId: string;
    rightDatasetId: string;
    leftColumn: string;
    rightColumn: string;
    leftUnique: boolean;
    rightUnique: boolean;
  }>;
};

function normalizedRelationshipKey(value: string) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function relationshipColumns(dataset: TabularDataset) {
  return dataset.columns.filter((column) => {
    const key = normalizedRelationshipKey(column.name);
    return key.length >= 3 && (key.endsWith('id') || key.endsWith('key') || key.endsWith('code'));
  });
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  return text.includes(',') || text.includes('"') || text.includes('\n')
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

/** Serialize an in-memory result table so a later analysis can use it as its exact input. */
export function tabularRowsToCsv(columns: string[], rows: Array<Record<string, unknown>>) {
  return [
    columns.map(csvCell).join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ].join('\n');
}

/** Serialize a stored dataset with RFC 4180-compatible quoting for sandbox analysis. */
export function tabularDatasetToCsv(dataset: TabularDataset) {
  const columns = dataset.columns.map((column) => column.name);
  return tabularRowsToCsv(columns, dataset.rows);
}

/**
 * Stage one or more selected datasets for a sandbox without exposing row data
 * to the chat model. A single dataset keeps the long-standing `data.csv`
 * contract; multiple datasets receive stable generic filenames plus a manifest
 * that maps each source ID and sheet name to its CSV file.
 */
export function createTabularSandboxFiles(datasets: TabularDataset[]): {
  files: TabularSandboxFile[];
  manifest?: TabularSandboxManifest;
} {
  if (datasets.length === 0) return { files: [] };

  const multiple = datasets.length > 1;
  const manifest: TabularSandboxManifest = { datasets: [], relationships: [] };
  const files = datasets.map((dataset, index) => {
    const name = multiple ? `dataset-${index + 1}.csv` : 'data.csv';
    manifest.datasets.push({
      id: dataset.id,
      fileName: dataset.fileName,
      file: name,
      rowCount: dataset.rowCount,
      columns: dataset.columns.map((column) => column.name),
    });
    return { name, content: tabularDatasetToCsv(dataset) };
  });

  for (let leftIndex = 0; leftIndex < datasets.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < datasets.length; rightIndex += 1) {
      const left = datasets[leftIndex];
      const right = datasets[rightIndex];
      for (const leftColumn of relationshipColumns(left)) {
        const rightColumn = relationshipColumns(right).find(
          (column) =>
            normalizedRelationshipKey(column.name) === normalizedRelationshipKey(leftColumn.name),
        );
        if (!rightColumn) continue;
        manifest.relationships.push({
          leftDatasetId: left.id,
          rightDatasetId: right.id,
          leftColumn: leftColumn.name,
          rightColumn: rightColumn.name,
          leftUnique: leftColumn.uniqueCount === left.rowCount,
          rightUnique: rightColumn.uniqueCount === right.rowCount,
        });
      }
    }
  }

  if (multiple) {
    files.push({ name: 'datasets.json', content: JSON.stringify(manifest, null, 2) });
    return { files, manifest };
  }

  return { files };
}

/**
 * Recover a common single-sheet code pattern when every selected dataset was
 * requested but the generated code still reads `data.csv`. Rewriting is safe
 * only when the number of reads exactly matches the selected datasets.
 */
export function remapLegacyMultiDatasetReads(code: string, datasetCount: number): string {
  if (datasetCount < 2) return code;

  const legacyRead = /pd\s*\.\s*read_(?:csv|excel)\(\s*(['"])data\.csv\1(?:\s*,[^)]*)?\s*\)/g;
  if ([...code.matchAll(legacyRead)].length !== datasetCount) return code;

  let datasetIndex = 0;
  return code.replace(legacyRead, () => `pd.read_csv('dataset-${++datasetIndex}.csv')`);
}

/**
 * Repoint literal filenames generated from visible dataset metadata to the
 * generic files mounted in the sandbox. Exact filename or dataset-ID matches
 * are required, so unrelated external paths remain untouched.
 */
export function remapMountedDatasetReads(
  code: string,
  manifest: TabularSandboxManifest | undefined,
): string {
  if (!manifest || manifest.datasets.length < 2) return code;
  const mountedByReference = new Map<string, string>();
  for (const dataset of manifest.datasets) {
    mountedByReference.set(dataset.fileName.toLocaleLowerCase(), dataset.file);
    mountedByReference.set(`${dataset.id}.csv`.toLocaleLowerCase(), dataset.file);
    mountedByReference.set(dataset.file.toLocaleLowerCase(), dataset.file);
  }
  const pathVariables = new Set(
    [...code.matchAll(/\b(?:pd|pandas)\s*\.\s*read_(?:csv|excel)\(\s*([A-Za-z_]\w*)\s*[,)]/g)].map(
      (match) => match[1],
    ),
  );
  code = code.replace(
    /^(\s*)([A-Za-z_]\w*)(\s*=\s*)(['"])([^'"\n]+)\4/gm,
    (match, indent: string, name: string, equals: string, quote: string, path: string) => {
      if (!pathVariables.has(name)) return match;
      const mounted = mountedByReference.get(path.split(/[\\/]/).at(-1)?.toLocaleLowerCase() ?? '');
      return mounted ? `${indent}${name}${equals}${quote}${mounted}${quote}` : match;
    },
  );
  const reader = /(\b(?:pd|pandas)\s*\.\s*read_(?:csv|excel)\(\s*)(['"])([^'"]+)\2/g;
  return code.replace(reader, (match, prefix: string, quote: string, path: string) => {
    const baseName = path.split(/[\\/]/).at(-1)?.toLocaleLowerCase() ?? '';
    const mounted = mountedByReference.get(baseName);
    return mounted ? `${prefix}${quote}${mounted}${quote}` : match;
  });
}

/** Repoint only the first model-authored input read to the staged source. */
export function remapSingleDatasetRead(code: string): string {
  const firstCsvRead = /\b(?:pd|pandas)\s*\.\s*read_csv\(\s*(?:(["'])[^"']*\1|[A-Za-z_]\w*)/;
  return code.replace(firstCsvRead, (match) => {
    const open = match.slice(0, match.indexOf('(') + 1);
    return `${open}'data.csv'`;
  });
}

/** Remove accidental one-space indentation from generated top-level Python. */
export function repairAccidentalTopLevelPythonIndent(code: string): string {
  return code.replace(/^ (?=\S)/gm, '');
}

/**
 * Notebook-style planners often leave a DataFrame, mapping, or tuple as the
 * final expression. Python scripts discard that value, so expose only a
 * clearly bare final expression while keeping assignments intentionally silent.
 */
export function printBareFinalPythonExpression(code: string) {
  const lines = code.split('\n');
  let index = lines.length - 1;
  while (index >= 0 && (!lines[index].trim() || lines[index].trim().startsWith('#'))) index -= 1;
  if (index < 0) return code;
  const expression = lines[index].trim();
  if (expression === '}') {
    let quote: "'" | '"' | "'''" | '\"\"\"' | undefined;
    let escaped = false;
    let comment = false;
    let depth = 0;
    let opening = -1;
    let finalRange: { start: number; end: number } | undefined;
    for (let cursor = 0; cursor < code.length; cursor += 1) {
      const character = code[cursor];
      if (comment) {
        if (character === '\n') comment = false;
        continue;
      }
      if (quote) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (character === '\\') {
          escaped = true;
          continue;
        }
        if (quote.length === 3) {
          if (code.slice(cursor, cursor + 3) === quote) {
            cursor += 2;
            quote = undefined;
          }
        } else if (character === quote) {
          quote = undefined;
        }
        continue;
      }
      if (character === '#') {
        comment = true;
        continue;
      }
      if (character === "'" || character === '"') {
        const triple = character.repeat(3) as "'''" | '\"\"\"';
        if (code.slice(cursor, cursor + 3) === triple) {
          quote = triple;
          cursor += 2;
        } else {
          quote = character;
        }
        continue;
      }
      if (character === '{') {
        if (depth === 0) opening = cursor;
        depth += 1;
      } else if (character === '}' && depth > 0) {
        depth -= 1;
        if (depth === 0 && opening >= 0) finalRange = { start: opening, end: cursor + 1 };
      }
    }
    if (finalRange && !code.slice(finalRange.end).trim()) {
      const lineStart = code.lastIndexOf('\n', finalRange.start - 1) + 1;
      if (!code.slice(lineStart, finalRange.start).trim()) {
        const dictionary = code.slice(finalRange.start, finalRange.end);
        return `${code.slice(0, finalRange.start)}print(repr((${dictionary})))${code.slice(finalRange.end)}`;
      }
    }
  }
  const identifier = '[A-Za-z_]\\w*';
  const literal = `(?:${identifier}|[-+]?\\d+(?:\\.\\d+)?|['"][^'"]*['"])`;
  const isBareIdentifier = new RegExp(`^${identifier}$`).test(expression);
  const mappingSelection = expression.match(
    new RegExp(`^(${identifier})\\s*\\[\\s*['"][^'"]+['"]\\s*\\]$`),
  );
  const isCompleteMappingSelection = Boolean(
    mappingSelection && new RegExp(`^\\s*${mappingSelection[1]}\\s*=\\s*\\{`, 'm').test(code),
  );
  const isSimpleTuple = new RegExp(`^\\(?${literal}(?:\\s*,\\s*${literal})+\\)?$`).test(expression);
  const isSelectedColumnsTuple = new RegExp(`^${identifier}\\s*\\[.+\\]\\s*,\\s*.+$`).test(
    expression,
  );
  const isResultAndRecordsTuple = new RegExp(
    `^${identifier}\\s*,\\s*${identifier}(?:\\s*\\[[^\\n]+\\])?\\s*\\.\\s*to_dict\\s*\\([^\\n]*\\)$`,
  ).test(expression);
  const isSelectedColumns = new RegExp(
    `^${identifier}\\s*\\[\\s*\\[\\s*['"][^'"]+['"](?:\\s*,\\s*['"][^'"]+['"])*\\s*\\]\\s*\\]$`,
  ).test(expression);
  const isToDictCall = new RegExp(
    `^${identifier}(?:\\s*\\[[^\\n]+\\])?\\s*\\.\\s*to_dict\\s*\\([^\\n]*\\)$`,
  ).test(expression);
  if (
    !isBareIdentifier &&
    !isCompleteMappingSelection &&
    !isSimpleTuple &&
    !isSelectedColumnsTuple &&
    !isResultAndRecordsTuple &&
    !isSelectedColumns &&
    !isToDictCall
  ) {
    return code;
  }
  const indentation = lines[index].match(/^\s*/)?.[0] ?? '';
  if (isSelectedColumns) {
    lines[index] = `${indentation}print((${expression}).to_string(index=False))`;
    return lines.join('\n');
  }
  if (isBareIdentifier) {
    lines[index] = `${indentation}_larkup_print_result(${expression})`;
    return lines.join('\n');
  }
  if (isToDictCall) {
    lines[index] = `${indentation}_larkup_print_result(${expression})`;
    return lines.join('\n');
  }
  if (isCompleteMappingSelection && mappingSelection) {
    lines[index] = `${indentation}_larkup_print_result(${mappingSelection[1]})`;
    return lines.join('\n');
  }
  if (isSimpleTuple || isSelectedColumnsTuple || isResultAndRecordsTuple) {
    lines[index] = `${indentation}_larkup_print_result((${expression}))`;
    return lines.join('\n');
  }
  // Parenthesize the expression explicitly. An unparenthesized tuple such as
  // `count, examples, explanation` would otherwise become repr(a, b, c),
  // which raises because repr accepts one argument.
  lines[index] = `${indentation}print(repr((${expression})))`;
  return lines.join('\n');
}

/** Route simple explicit prints through the same stable DataFrame formatter. */
export function remapSimplePythonPrints(code: string) {
  return code.replace(
    /(^|\n)(\s*)print\(\s*([A-Za-z_]\w*)\s*\)(?=\s*(?:\n|$))/gu,
    (_match, lineStart: string, indentation: string, identifier: string) =>
      `${lineStart}${indentation}_larkup_print_result(${identifier})`,
  );
}

/**
 * Notebook-style code generators occasionally emit ``value.print()`` after a
 * pandas selection. Series and DataFrames do not expose that method; route it
 * through the already-installed result formatter before the first execution.
 */
export function remapPythonObjectPrintMethods(code: string) {
  return code.replace(
    /(^|\n)(\s*)([A-Za-z_]\w*(?:\[[^\n]+\]|\.[A-Za-z_]\w*|\([^\n]*\))*)\.print\(\)(?=\s*(?:\n|$))/gu,
    (_match, lineStart: string, indentation: string, expression: string) =>
      `${lineStart}${indentation}_larkup_print_result(${expression})`,
  );
}

/** Preserve notebook-style scalar tuples that appear before later explanation code. */
export function printBareTopLevelPythonTuples(code: string) {
  const tuple = /^([A-Za-z_]\w*)(\s*,\s*[A-Za-z_]\w*)+\s*$/;
  const identifierAndCall = /^([A-Za-z_]\w*)\s*,\s*[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\([^\n]*\)\s*$/;
  return code
    .split('\n')
    .map((line) =>
      tuple.test(line) || identifierAndCall.test(line)
        ? `_larkup_print_result((${line.trim()}))`
        : line,
    )
    .join('\n');
}

/** Repair string comparisons emitted for CSV columns that parsed as booleans. */
export function remapBooleanStringLiterals(code: string, datasets: TabularDataset[]) {
  const booleanColumns = datasets.flatMap((dataset) =>
    dataset.columns
      .filter((column) => {
        const values = dataset.rows
          .slice(0, 200)
          .map((row) => row[column.name])
          .filter((value) => value !== null && value !== undefined);
        const normalized = values.map((value) =>
          typeof value === 'string' ? value.trim().toLocaleLowerCase() : value,
        );
        return (
          normalized.length > 0 &&
          normalized.every(
            (value) => value === true || value === false || value === 'true' || value === 'false',
          )
        );
      })
      .map((column) => column.name),
  );
  const referencesBooleanColumn = booleanColumns.some(
    (column) => code.includes(JSON.stringify(column)) || code.includes(`'${column}'`),
  );
  if (!referencesBooleanColumn) return code;
  let repaired = code;
  for (const column of booleanColumns) {
    const escapedColumn = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const stringAccessor = `(\\b[A-Za-z_]\\w*\\s*\\[\\s*['"]${escapedColumn}['"]\\s*\\])\\.str\\.lower\\(\\)`;
    const booleanStringAccessor = (value: 'true' | 'false') =>
      new RegExp(`${stringAccessor}\\.eq\\(\\s*['"]${value}['"]\\s*\\)`, 'gi');
    const booleanStringComparison = (operator: '==' | '!=', value: 'true' | 'false') =>
      new RegExp(`${stringAccessor}\\s*${operator}\\s*['"]${value}['"]`, 'gi');
    repaired = repaired
      .replace(booleanStringAccessor('true'), '$1.eq(True)')
      .replace(booleanStringAccessor('false'), '$1.eq(False)')
      .replace(booleanStringComparison('==', 'true'), '$1 == True')
      .replace(booleanStringComparison('==', 'false'), '$1 == False')
      .replace(booleanStringComparison('!=', 'true'), '$1 != True')
      .replace(booleanStringComparison('!=', 'false'), '$1 != False');
  }
  return repaired.replace(/(['"])True\1/g, 'True').replace(/(['"])False\1/g, 'False');
}

/** Route model-authored saved figures through the sandbox's captured display hook. */
export function remapSavedFiguresToShow(code: string) {
  return code.replace(/\b(?:plt|fig)\.savefig\([^\n]*\)/g, 'plt.show()');
}

/** Apply Python's own unambiguous identifier suggestion before the one retry. */
export function repairSuggestedPythonNameError(code: string, stderr: string) {
  const suggestion = stderr.match(
    /NameError: name '([A-Za-z_]\w*)' is not defined\. Did you mean: '([A-Za-z_]\w*)'\?/,
  );
  if (!suggestion || suggestion[1] === suggestion[2]) return code;
  return code.replace(new RegExp(`\\b${suggestion[1]}\\b`, 'g'), suggestion[2]);
}

/** Strip trailing truncated code when model output was cut off mid-statement. */
export function repairUnterminatedPythonCode(code: string, stderr: string): string {
  if (!/SyntaxError.*unterminated (?:string literal|f-string)/i.test(stderr)) return code;
  const lineMatch = stderr.match(/(?:detected at |at )?line\s+(\d+)/i);
  if (!lineMatch) return code;
  const errorLine = parseInt(lineMatch[1], 10);
  const lines = code.split('\n');
  if (errorLine > 1 && errorLine <= lines.length) {
    // The model hit its output limit; drop the incomplete tail
    return lines.slice(0, errorLine - 1).join('\n');
  }
  return code;
}

/** Repair a common pandas misconception: merge keys are not given _y suffixes. */
export function repairMissingPandasMergeKeySuffix(code: string, stderr: string) {
  const missing = stderr.match(/KeyError:\s*['"]([A-Za-z_]\w*)_y['"]/);
  if (!missing) return code;
  const key = missing[1];
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const framePattern = new RegExp(
    `\\b([A-Za-z_]\\w*)\\s*\\[\\s*['"]${escapedKey}_y['"]\\s*\\]`,
    'g',
  );
  const frames = [...code.matchAll(framePattern)].map((match) => match[1]);
  if (frames.length === 0) return code;

  let repaired = code;
  for (const frame of new Set(frames)) {
    const escapedFrame = frame.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mergePattern = new RegExp(
      `^(\\s*${escapedFrame}\\s*=\\s*(?:pd|pandas)\\.merge\\([^\\n]*\\))$`,
      'm',
    );
    const merge = repaired.match(mergePattern)?.[1];
    if (
      !merge ||
      !new RegExp(`\\bon\\s*=\\s*['"]${escapedKey}['"]`).test(merge) ||
      !/\bhow\s*=\s*['"]left['"]/.test(merge)
    ) {
      continue;
    }
    if (!/\bindicator\s*=/.test(merge)) {
      repaired = repaired.replace(merge, merge.replace(/\)$/, ', indicator=True)'));
    }
    const access = `${escapedFrame}\\s*\\[\\s*['"]${escapedKey}_y['"]\\s*\\]`;
    repaired = repaired
      .replace(new RegExp(`~\\s*${access}\\.isna\\(\\)`, 'g'), `${frame}['_merge'].eq('both')`)
      .replace(
        new RegExp(`${access}\\.(?:notna|notnull)\\(\\)`, 'g'),
        `${frame}['_merge'].eq('both')`,
      )
      .replace(
        new RegExp(`${access}\\.(?:isna|isnull)\\(\\)`, 'g'),
        `${frame}['_merge'].eq('left_only')`,
      );
  }
  return repaired;
}

/** Prefer the left copy when pandas suffixes a duplicated non-key merge column. */
export function repairMissingPandasMergeColumnSuffix(
  code: string,
  stderr: string,
  datasets: TabularDataset[],
) {
  const missing = stderr.match(/KeyError:\s*['"]([A-Za-z_]\w*)['"]/);
  if (!missing || missing[1].endsWith('_x') || missing[1].endsWith('_y')) return code;
  const column = missing[1];
  const datasetCount = datasets.filter((dataset) =>
    dataset.columns.some((candidate) => candidate.name === column),
  ).length;
  if (datasetCount < 2) return code;

  const escapedColumn = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const accessPattern = new RegExp(
    `\\b([A-Za-z_]\\w*)\\s*\\[\\s*['"]${escapedColumn}['"]\\s*\\]`,
    'g',
  );
  const frames = [...code.matchAll(accessPattern)].map((match) => match[1]);
  let repaired = code;
  for (const frame of new Set(frames)) {
    const escapedFrame = frame.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const createsMergedFrame = new RegExp(
      `^\\s*${escapedFrame}\\s*=\\s*[^\\n]*\\.merge\\s*\\(`,
      'm',
    ).test(code);
    if (!createsMergedFrame) continue;
    repaired = repaired.replace(
      new RegExp(`\\b${escapedFrame}\\s*\\[\\s*(['"])${escapedColumn}\\1\\s*\\]`, 'g'),
      `${frame}['${column}_x']`,
    );
  }
  return repaired;
}

/** Remove a terminal escape that consumes the only closing quote on a Python line. */
export function repairEscapedPythonClosingQuote(code: string) {
  return code
    .split('\n')
    .map((line) => line.replace(/\\(["'])(\s*\))\s*$/, '$1$2'))
    .join('\n');
}

function decodeSimplePythonString(value: string) {
  return value.replace(/\\([\\'\"])/g, '$1');
}

function normalizedColumnName(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchingSchemaColumn(authored: string, columns: string[]) {
  const normalizedAuthored = normalizedColumnName(authored);
  if (normalizedAuthored.length < 12) return undefined;
  const authoredTokens = new Set(normalizedAuthored.split(' ').filter((token) => token.length > 2));
  const candidates = columns.filter((column) => {
    const normalizedColumn = normalizedColumnName(column);
    if (normalizedColumn === normalizedAuthored) return true;
    // Unknown identifiers can be derived, renamed, or aggregation-created fields.
    // Only exact normalization is safe; shared prefixes do not establish identity.
    if (/^[A-Za-z_]\w*$/u.test(authored)) return false;
    if (
      normalizedAuthored.length >= 18 &&
      (normalizedColumn.startsWith(`${normalizedAuthored} `) ||
        normalizedColumn.endsWith(` ${normalizedAuthored}`) ||
        normalizedAuthored.startsWith(`${normalizedColumn} `) ||
        normalizedAuthored.endsWith(` ${normalizedColumn}`))
    ) {
      return true;
    }
    const columnTokens = new Set(normalizedColumn.split(' ').filter((token) => token.length > 2));
    const shared = [...authoredTokens].filter((token) => columnTokens.has(token)).length;
    return shared >= 4 && shared / Math.min(authoredTokens.size, columnTokens.size) >= 0.8;
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * Repair model-authored column references only when they map unambiguously to
 * one real column. Form exports commonly wrap a short question in a much
 * longer heading, and generated Python may also quote apostrophes incorrectly.
 */
export function remapSingleDatasetColumnReferences(code: string, dataset: TabularDataset) {
  const columns = dataset.columns.map((column) => column.name);
  const stringLiteral = /(['"])((?:\\.|(?!\1)[^\\])*)\1/g;
  const derivedColumns = new Set<string>();
  for (const match of code.matchAll(
    /\[\s*(['"])((?:\\.|[^'"\n])+)\1\s*\]\s*(?:[+*\/-]?=(?!=))/gu,
  )) {
    derivedColumns.add(decodeSimplePythonString(match[2]));
  }
  for (const call of code.matchAll(/\.assign\(([\s\S]{0,2000}?)\)/gu)) {
    for (const match of call[1].matchAll(/\b([A-Za-z_]\w*)\s*=/gu)) derivedColumns.add(match[1]);
  }

  // A form-export header can contain the same apostrophe or quote a model used
  // to delimit it, leaving otherwise reasonable code syntactically invalid.
  // Replace only exact, known schema labels before parsing ordinary literals.
  let repairedCode = code;
  for (const column of columns) {
    const safeLiteral = JSON.stringify(column);
    repairedCode = repairedCode.split(`'${column}'`).join(safeLiteral);
    repairedCode = repairedCode.split(`"${column}"`).join(safeLiteral);
  }

  // Recover malformed quoted entries in Python lists. The closing quote must
  // be followed by a list delimiter, so apostrophes inside contractions do not
  // terminate the candidate early.
  const tolerantListLiteral = /(^|,\s*)(['"])((?:\\.|[\s\S]){1,2000}?)\2(?=\s*(?:,|$))/g;
  repairedCode = repairedCode.replace(/\[\[([\s\S]{1,10000}?)\]\]/g, (selection) =>
    selection.replace(
      tolerantListLiteral,
      (literal, prefix: string, _quote: string, encoded: string) => {
        const authored = decodeSimplePythonString(encoded);
        if (derivedColumns.has(authored)) return literal;
        const column = matchingSchemaColumn(authored, columns);
        return column ? `${prefix}${JSON.stringify(column)}` : literal;
      },
    ),
  );

  return repairedCode.replace(
    stringLiteral,
    (literal, _quote: string, encoded: string, offset: number) => {
      // Column repair applies to ordinary literals used as dataframe keys. An
      // f-string is output text whose embedded column references must stay
      // intact; replacing the whole label (for example "Dropout Rate in
      // {row['arm']}") with "arm" destroys otherwise correct artifacts.
      if (offset > 0 && /[fFrRbBuU]/u.test(repairedCode[offset - 1])) return literal;
      const prefix = repairedCode
        .slice(Math.max(0, offset - 2000), offset)
        .replace(stringLiteral, '""');
      const isSelection = /\b[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\s*\[\[?(?:\s*""\s*,)*\s*$/u.test(
        prefix,
      );
      const isColumnMethod =
        /\.(?:groupby|sort_values|dropna|drop_duplicates|set_index|pivot_table|melt|merge|agg)\s*\([^)]*$/u.test(
          prefix,
        );
      if (!isSelection && !isColumnMethod) return literal;
      const authored = decodeSimplePythonString(encoded);
      if (columns.includes(authored) || derivedColumns.has(authored)) return literal;
      const column = matchingSchemaColumn(authored, columns);
      return column ? JSON.stringify(column) : literal;
    },
  );
}
