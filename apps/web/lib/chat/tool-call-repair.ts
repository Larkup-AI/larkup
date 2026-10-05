import type { ToolCallRepairFunction } from 'ai';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const limitToken = /^["']*limit["']*\s*:\s*(\d+)\s*,?\s*$/i;
const columnsToken = /^["']*columns["']*\s*:\s*\[?\s*$/i;
const closingListToken = /^\]\s*,?\s*$/;

/**
 * Recover the specific valid-JSON shape produced when a model accidentally
 * continues top-level tabular arguments inside a long filters array.
 */
export function repairQueryTabularDataInput(value: unknown): JsonObject | null {
  if (!isObject(value) || !Array.isArray(value.filters)) return null;

  const validFilters: JsonObject[] = [];
  const repairedColumns: string[] = [];
  let repairedLimit: number | undefined;
  let readingColumns = false;
  let foundMisplacedArgument = false;

  for (const entry of value.filters) {
    if (isObject(entry)) {
      // Once a list argument starts, another filter object is ambiguous. Let
      // the normal schema error surface instead of silently changing intent.
      if (readingColumns) return null;
      validFilters.push(entry);
      continue;
    }
    if (typeof entry !== 'string') return null;

    const token = entry.trim();
    if (readingColumns) {
      if (!closingListToken.test(token) && token) repairedColumns.push(entry);
      continue;
    }

    const limitMatch = token.match(limitToken);
    if (limitMatch) {
      repairedLimit = Number(limitMatch[1]);
      foundMisplacedArgument = true;
      continue;
    }
    if (columnsToken.test(token)) {
      readingColumns = true;
      foundMisplacedArgument = true;
      continue;
    }

    // A standalone string is not a filter. Only repair the known misplaced
    // argument pattern; arbitrary invalid input remains rejected by the SDK.
    return null;
  }

  if (!foundMisplacedArgument || (readingColumns && repairedColumns.length === 0)) return null;
  if (repairedLimit !== undefined && value.limit !== undefined) return null;
  if (repairedColumns.length > 0 && value.columns !== undefined) return null;

  return {
    ...value,
    filters: validFilters,
    ...(repairedLimit === undefined ? {} : { limit: repairedLimit }),
    ...(repairedColumns.length === 0 ? {} : { columns: repairedColumns }),
  };
}

/** Repair only known, deterministic chat tool-call mistakes. */
export const repairChatToolCall: ToolCallRepairFunction<any> = async ({ toolCall }) => {
  if (toolCall.toolName !== 'queryTabularData') return null;

  let input: unknown;
  try {
    input = JSON.parse(toolCall.input);
  } catch {
    return null;
  }

  const repaired = repairQueryTabularDataInput(input);
  return repaired ? { ...toolCall, input: JSON.stringify(repaired) } : null;
};
