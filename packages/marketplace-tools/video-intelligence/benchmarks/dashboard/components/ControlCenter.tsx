'use client';
import { useCallback, useEffect, useState } from 'react';
import type { ProviderScope, LogPage } from '../lib/contract.js';
import {
  read,
  operate,
  download,
  type SystemStatus,
  type JsonRow,
  type Page,
} from '../lib/operator.js';

export function DataGrid({ items, columns }: { items: JsonRow[]; columns?: string[] }) {
  const fields = columns ?? [...new Set(items.flatMap((row) => Object.keys(row)))];
  return (
    <div className="data-scroll">
      <table>
        <thead>
          <tr>
            {fields.map((key) => (
              <th key={key}>{key}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((row, index) => (
            <tr key={String(row.id ?? row.taskId ?? index)}>
              {fields.map((key) => {
                const value = row[key];
                const text =
                  typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? '—');
                return (
                  <td key={key}>
                    {text.length > 100 ? (
                      <details>
                        <summary>{text.slice(0, 85)}…</summary>
                        <pre>{text}</pre>
                      </details>
                    ) : (
                      <span>{text}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {!items.length && <p className="muted">No rows available.</p>}
    </div>
  );
}

export function ControlCenter({
  enabled,
  onLive,
}: {
  enabled: boolean;
  onLive: (live: boolean) => void;
}) {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [force, setForce] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const refresh = useCallback(async () => {
    try {
      const next = await read<SystemStatus>('/system');
      setStatus(next);
      onLive(next.controllerAvailable);
      setError('');
    } catch (e) {
      setError(String(e));
      onLive(false);
    }
  }, [onLive]);
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [enabled, refresh]);
  const action = async (name: string) => {
    if (!status) return;
    setBusy(true);
    setError('');
    try {
      await operate(name, status.revision, name === 'force-stop-gpu' ? confirmation : undefined);
      setForce(false);
      setConfirmation('');
      await refresh();
    } catch (e) {
      await refresh();
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const active = status?.operations.some((job) => ['pending', 'running'].includes(job.state));
  const readonly = !enabled || !status || status.readonly;
  return (
    <section className="panel">
      <h2>Benchmark control</h2>
      <div className="kv">
        <div className="cell">
          <div className="k">GPU Pod</div>
          <div className="v">{status?.pod.state ?? 'Not connected'}</div>
          <small>
            {status?.pod.observedAt
              ? new Date(status.pod.observedAt).toLocaleString()
              : 'Not yet observed'}
          </small>
        </div>
        <div className="cell">
          <div className="k">Controller</div>
          <div className="v">{status?.controllerAvailable ? 'Live' : 'Saved data / offline'}</div>
        </div>
        <div className="cell">
          <div className="k">Supervisor</div>
          <div className="v">{status?.supervisor.mode ?? 'Unavailable'}</div>
        </div>
      </div>
      <div className="controls">
        {status?.operations.some(
          (job) => ['pending', 'running'].includes(job.state) && job.cancellable,
        ) && (
          <button disabled={readonly || busy} onClick={() => action('cancel-start')}>
            Cancel startup
          </button>
        )}
        <button disabled={readonly || busy || active} onClick={() => action('start')}>
          Start / resume benchmark
        </button>
        <button
          disabled={readonly || busy || active || !status?.controllerAvailable}
          onClick={() => action('pause')}
        >
          Pause all runs
        </button>
        <button
          disabled={readonly || busy || active || !status?.controllerAvailable}
          onClick={() => action('resume')}
        >
          Resume selected run
        </button>
        <button
          disabled={readonly || busy || active || !status?.controllerAvailable}
          onClick={() => action('stop-gpu')}
        >
          Save &amp; stop GPU
        </button>
        <button className="danger" disabled={readonly || busy} onClick={() => setForce(!force)}>
          Force stop GPU…
        </button>
      </div>
      <p className="note">
        Start resumes the saved GPU and the smoke → pilot workflow; provider charges may apply. Save
        &amp; stop pauses dispatch, drains requests and backs up before stopping compute.
      </p>
      {readonly && (
        <p className="note">
          Controls disabled. Use <code>./launch.sh dashboard</code> for real operator controls.{' '}
          <code>--view-only</code> permits no writes or GPU starts.
        </p>
      )}
      {force && (
        <div className="banner error">
          <strong>Emergency GPU stop</strong>
          <p>
            Skips draining and the final backup. In-flight provider calls may still charge;
            interrupted outcomes require reconciliation.
          </p>
          <label>
            Type STOP GPU{' '}
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
            />
          </label>
          <div className="controls">
            <button
              className="danger"
              disabled={confirmation !== 'STOP GPU' || busy}
              onClick={() => action('force-stop-gpu')}
            >
              Force stop now
            </button>
            <button onClick={() => setForce(false)}>Keep running</button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="issue">
          {error}
        </p>
      )}
      {status?.operations.slice(0, 4).map((job) => (
        <div className="note" key={job.id}>
          <strong>
            {job.action}: {job.state}
          </strong>{' '}
          {job.stage} {job.issue?.message} {job.warning}
        </div>
      ))}
    </section>
  );
}

export function DatabaseTab({ runId }: { runId: string | null }) {
  const [tables, setTables] = useState<{ name: string; rowCount: number }[]>([]);
  const [table, setTable] = useState('tasks');
  const [page, setPage] = useState<Page | null>(null);
  const [cursor, setCursor] = useState('0');
  const [all, setAll] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    read<{ items: typeof tables }>('/database/tables')
      .then((result) => setTables(result.items))
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      read<Page>(
        `/database/${table}?limit=50&cursor=${cursor}${!all && runId ? '&runId=' + encodeURIComponent(runId) : ''}`,
      )
        .then((result) => {
          if (!cancelled) {
            setPage(result);
            setError('');
          }
        })
        .catch((e) => {
          if (!cancelled) setError(String(e));
        });
    void load();
    const timer = setInterval(load, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [table, cursor, runId, all]);
  return (
    <section className="panel">
      <h2>Database rows · readonly</h2>
      <div className="controls">
        <label>
          Table{' '}
          <select
            value={table}
            onChange={(event) => {
              setTable(event.target.value);
              setCursor('0');
            }}
          >
            {tables.map((item) => (
              <option key={item.name}>{item.name}</option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={all}
            onChange={(event) => {
              setAll(event.target.checked);
              setCursor('0');
            }}
          />{' '}
          All runs
        </label>
        <a
          className="btn-link"
          href={`/api/v1/database/${table}/export.json${!all && runId ? '?runId=' + encodeURIComponent(runId) : ''}`}
        >
          Export table JSON
        </a>
      </div>
      <p className="note">
        Actual stored rows; JSON documents expand inline. Credentials, gold labels and signed URL
        parameters are redacted. No SQL execution or database writes.
      </p>
      {error && (
        <p role="alert" className="issue">
          {error}
        </p>
      )}
      {page && <DataGrid items={page.items} columns={page.columns} />}
      <div className="controls">
        <button disabled={cursor === '0'} onClick={() => setCursor('0')}>
          First page
        </button>
        <button disabled={!page?.hasMore} onClick={() => setCursor(page!.nextCursor!)}>
          Next 50 rows
        </button>
        <span>
          Offset {cursor} · {tables.find((item) => item.name === table)?.rowCount ?? '?'} total rows
        </span>
      </div>
    </section>
  );
}

export function RecordsTab({ runId, kind }: { runId: string | null; kind: 'tasks' | 'results' }) {
  const [page, setPage] = useState<Page | null>(null);
  const [cursor, setCursor] = useState('0');
  const [error, setError] = useState('');
  useEffect(() => setCursor('0'), [runId, kind]);
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    const load = () =>
      read<Page>(`/runs/${encodeURIComponent(runId)}/${kind}?limit=50&cursor=${cursor}`)
        .then((result) => {
          if (!cancelled) {
            setPage(result);
            setError('');
          }
        })
        .catch((e) => {
          if (!cancelled) setError(String(e));
        });
    void load();
    const timer = setInterval(load, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runId, kind, cursor]);
  return (
    <section className="panel">
      <h2>{kind === 'tasks' ? 'Processes and task attempts' : 'Individual results'}</h2>
      {runId && (
        <div className="controls">
          <a
            className="btn-link"
            href={`/api/v1/runs/${encodeURIComponent(runId)}/exports/results.json`}
          >
            Export full run JSON
          </a>
          <a
            className="btn-link"
            href={`/api/v1/runs/${encodeURIComponent(runId)}/exports/results.csv`}
          >
            Export results CSV
          </a>
        </div>
      )}
      {error && <p className="issue">{error}</p>}
      {page && <DataGrid items={page.items} />}
      {!runId && <p>Select a run.</p>}
      <div className="controls">
        <button disabled={cursor === '0'} onClick={() => setCursor('0')}>
          First page
        </button>
        <button disabled={!page?.hasMore} onClick={() => setCursor(page!.nextCursor!)}>
          Next 50 rows
        </button>
      </div>
    </section>
  );
}

export function LogsTab() {
  const [service, setService] = useState('operator');
  const [page, setPage] = useState<LogPage | null>(null);
  const [lines, setLines] = useState<LogPage['lines']>([]);
  const [error, setError] = useState('');
  const [fromStart, setFromStart] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let cursor: string | undefined;
    setLines([]);
    setPage(null);
    const load = async () => {
      try {
        const next = await read<LogPage>(
          `/logs?service=${service}&limit=200${cursor !== undefined ? '&cursor=' + cursor : fromStart ? '&cursor=0' : '&follow=1'}`,
        );
        if (cancelled) return;
        cursor = next.nextCursor;
        setPage(next);
        setLines((old) => [...old, ...next.lines].slice(-3000));
        setError('');
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    };
    void load();
    const timer = setInterval(load, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [service, fromStart]);
  return (
    <section className="panel">
      <h2>Service logs</h2>
      <div className="controls">
        <label>
          Service{' '}
          <select value={service} onChange={(event) => setService(event.target.value)}>
            {['operator', 'controller', 'runtime', 'bootstrap', 'relay', 'dashboard', 'tunnel'].map(
              (name) => (
                <option key={name}>{name}</option>
              ),
            )}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={fromStart}
            onChange={(event) => setFromStart(event.target.checked)}
          />{' '}
          Read from beginning
        </label>
        <button
          onClick={() =>
            download({ service, lines, nextCursor: page?.nextCursor }, service + '-logs.json')
          }
        >
          Export loaded logs JSON
        </button>
      </div>
      <p className="note">
        Live polling every 2 seconds. Credentials are redacted. The view retains the latest 3,000
        loaded lines; log history is paginated by byte cursor.
      </p>
      {error && <p className="issue">{error}</p>}
      {page && !page.available && (
        <p>{page.reason ?? 'No log has been written for this service yet.'}</p>
      )}
      <pre className="log-view">
        {lines.map((line) => line.text).join('\n') || 'Waiting for log records…'}
      </pre>
    </section>
  );
}

export function ServicesTab({ scopes }: { scopes: ProviderScope[] }) {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [profiles, setProfiles] = useState<unknown>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const load = () =>
      Promise.all([read<SystemStatus>('/system'), read('/config')])
        .then(([system, config]) => {
          setStatus(system);
          setProfiles(config);
          setError('');
        })
        .catch((e) => setError(String(e)));
    void load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, []);
  return (
    <section className="panel">
      <h2>Services &amp; providers</h2>
      {error && <p className="issue">{error}</p>}
      <h3>Processes</h3>
      <DataGrid items={status?.services ?? []} />
      <h3>Observed provider scopes</h3>
      <DataGrid items={scopes.map((scope) => ({ ...scope }))} />
      <p className="note">
        Unknown health or balance means unobserved. These are metadata checks, not paid inference
        probes.
      </p>
      <h3>Declared model roles and routing</h3>
      <details>
        <summary>View sanitized configuration</summary>
        <pre>{JSON.stringify(profiles, null, 2)}</pre>
      </details>
    </section>
  );
}
