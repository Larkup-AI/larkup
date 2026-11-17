import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Persist before submission; an uncertain result requires reconciliation, never a paid retry. */
export function cachedRewatchModel(base, { directory, name, actions, caseKey, limit = 4 }) {
  if (!Number.isInteger(limit) || limit < 0 || limit > 4) throw Error('BENCHMARK_REWATCH_INVALID_LIMIT');
  const pending = new Map();
  const owner = randomUUID();
  let submitted = 0;
  return new Proxy(base, { get(target, property) {
    if (property !== 'doGenerate') {
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    }
    return async (options) => {
      const key = createHash('sha256').update(JSON.stringify({ model: name, ...options, abortSignal: undefined, headers: undefined })).digest('hex');
      if (pending.has(key)) return pending.get(key);
      const operation = (async () => {
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        const file = path.join(directory, key + '.json');
        try {
          const saved = JSON.parse(await fs.readFile(file, 'utf8'));
          if (saved.state !== 'completed') throw Error('REMOTE_OUTCOME_UNKNOWN');
          actions.push({ action: 'canonicalReWatchCache', requestId: key });
          return saved.result;
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        // Switching model/range must not bypass an unresolved submission from a previous process.
        for (const entry of await fs.readdir(directory)) {
          if (!entry.endsWith('.json')) continue;
          const saved = JSON.parse(await fs.readFile(path.join(directory, entry), 'utf8'));
          if (saved.caseKey === caseKey && saved.state !== 'completed' && saved.owner !== owner) throw Error('REMOTE_OUTCOME_UNKNOWN');
        }
        if (submitted >= limit) throw Error('BENCHMARK_REWATCH_CALL_LIMIT');
        submitted++; // Reserve synchronously before yielding to concurrent range requests.
        const fence = await fs.open(file, 'wx', 0o600);
        await fence.writeFile(JSON.stringify({ state: 'submitted', model: name, caseKey, owner, submittedAt: new Date().toISOString() }));
        await fence.close();
        actions.push({ action: 'canonicalReWatchSubmitted', requestId: key, model: name });
        const result = await target.doGenerate(options);
        const partial = file + '.partial';
        await fs.writeFile(partial, JSON.stringify({ state: 'completed', model: name, caseKey, result }), { mode: 0o600 });
        await fs.rename(partial, file);
        actions.push({ action: 'canonicalReWatchCompleted', requestId: key });
        return result;
      })();
      pending.set(key, operation);
      return operation;
    };
  }});
}
