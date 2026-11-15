import type { OperatorOperation as Operation } from './contract.js';
export type {
  JsonRow,
  DatabasePage as Page,
  OperatorOperation as Operation,
  SystemStatus,
} from './contract.js';
export async function read<T>(path: string): Promise<T> {
  const response = await fetch('/api/v1' + path, { cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw Error(body.error?.message ?? `Request failed (${response.status})`);
  return body as T;
}
export async function operate(
  action: string,
  revision: string,
  confirmation?: string,
  runId?: string,
): Promise<Operation> {
  const response = await fetch('/api/v1/system/' + action, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
    },
    body: JSON.stringify({
      expectedRevision: revision,
      ...(confirmation ? { confirmation } : {}),
      ...(runId ? { runId } : {}),
    }),
  });
  const body = await response.json();
  if (!response.ok) throw Error(body.error?.message ?? `Operation rejected (${response.status})`);
  return body as Operation;
}
export function download(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Honor an explicitly opened run before following later operator selections. */
export function shouldFollowRun(
  previous: string | null,
  next: string,
  requested: string | null,
): boolean {
  return previous !== next && !(previous === null && requested !== null);
}
