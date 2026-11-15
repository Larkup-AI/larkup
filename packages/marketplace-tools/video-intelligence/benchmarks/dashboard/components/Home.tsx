'use client';
import { useEffect, useState } from 'react';
import type { RunSummary, RunSnapshot, RunMetrics, TaskObject } from '../lib/contract.js';
import { operate, type SystemStatus } from '../lib/operator.js';
import { fmtMoney, fmtDuration } from '../lib/format.js';
import { api } from '../lib/client.js';

export function Home({
  runs,
  selected,
  onSelect,
  snapshot: loadedSnapshot,
  metrics: loadedMetrics,
  tasks,
  system,
  operatorEnabled,
}: {
  runs: RunSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
  snapshot: RunSnapshot | null;
  metrics: RunMetrics | null;
  tasks: TaskObject[];
  system: SystemStatus | null;
  operatorEnabled: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const pending = system?.operations.find((o) => ['pending', 'running'].includes(o.state));
  const queued = system?.operations.find(
    (o) => o.action === 'new-run' && ['pending', 'running'].includes(o.state) && !o.result?.runId,
  );
  const [showQueue, setShowQueue] = useState(true);
  useEffect(() => {
    setShowQueue(true);
  }, [queued?.id]);
  const queueView = !!queued && showQueue;
  const queueLabel =
    queued?.startup?.phase === 'waiting_capacity' ? 'Waiting for GPU' : 'Starting services';
  const snapshot = queueView || loadedSnapshot?.id !== selected ? null : loadedSnapshot;
  const metrics = snapshot ? loadedMetrics : null;
  const latest = system?.operations[0];
  const disabled = !operatorEnabled || !system || system.readonly || busy || !!pending;
  const active = runs.some((r) => ['running', 'pausing', 'cancelling'].includes(r.state));
  async function action(name: string) {
    if (!system) return;
    setBusy(true);
    setMessage('');
    try {
      const op = await operate(
        name,
        system.revision,
        undefined,
        name === 'resume-run' ? (selected ?? undefined) : undefined,
      );
      setMessage(
        name === 'cancel-start'
          ? 'Startup cancellation requested.'
          : `${name === 'new-run' ? 'New benchmark' : name === 'resume-run' ? 'Resume selected run' : name} accepted. GPU startup and capacity waits are automatic.`,
      );
      if (op.result?.runId) onSelect(op.result.runId);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const rows = metrics?.summary?.filter((r) => r.system !== 'retrieval') ?? [];
  const systems = ['larkup', 'gemini', 'qwen', 'muse', 'minimax', 'twelvelabs'] as const;
  return (
    <>
      <section className="panel">
        <h2>Your benchmark</h2>
        <label htmlFor="selected-run">Experiment </label>
        <select
          id="selected-run"
          value={queueView ? queued.id : (selected ?? '')}
          onChange={(e) => {
            if (e.target.value === queued?.id) setShowQueue(true);
            else {
              setShowQueue(false);
              onSelect(e.target.value);
            }
          }}
        >
          {queued && (
            <option value={queued.id}>
              New benchmark · {queueLabel} · request {queued.id}
            </option>
          )}
          {!runs.length && !queued && <option value="">No experiments yet</option>}
          {runs.map((r) => (
            <option key={r.id} value={r.id}>
              {r.phase} · {r.state} · {new Date(r.updatedAt).toLocaleString()} · {r.id}
            </option>
          ))}
        </select>
        <div className="controls">
          <button disabled={disabled || active} onClick={() => action('new-run')}>
            New benchmark
          </button>
          <button
            disabled={
              disabled ||
              !selected ||
              !snapshot ||
              !['draft', 'paused', 'blocked'].includes(snapshot.state) ||
              active
            }
            onClick={() => action('resume-run')}
          >
            Resume selected run
          </button>
          <button disabled={disabled || !active} onClick={() => action('pause')}>
            Pause
          </button>
          <button
            disabled={disabled || !system?.controllerAvailable}
            onClick={() => action('stop-gpu')}
          >
            Save & stop GPU
          </button>
        </div>
        <p className="note">
          New requests appear here immediately while GPU capacity is pending. Once services are
          ready, the request is replaced by its experiment. Resume continues only the selected
          experiment and keeps its completed answers.
        </p>
        {message && <p role="status">{message}</p>}
        {pending && (
          <p role="status">
            {pending.stage ?? 'Preparing benchmark services…'}
            {pending.startup?.nextRetryAt && (
              <> Next attempt: {new Date(pending.startup.nextRetryAt).toLocaleTimeString()}.</>
            )}
          </p>
        )}
        {pending?.cancellable && (
          <div className="controls">
            <button
              disabled={!operatorEnabled || system?.readonly || busy}
              onClick={() => action('cancel-start')}
            >
              Cancel startup
            </button>
          </div>
        )}
        {latest?.state === 'failed' && (
          <p className="banner error">
            {latest.issue?.message ?? 'The last operation failed. See Advanced → Events.'}
          </p>
        )}
      </section>
      <section className="panel">
        <div className="home-status">
          <strong>{queueView ? queueLabel : (snapshot?.state ?? 'No run selected')}</strong>
          <span>
            GPU:{' '}
            {pending?.startup?.phase === 'waiting_capacity'
              ? 'Waiting for capacity'
              : pending?.startup?.phase === 'starting_gpu'
                ? 'Waking up'
                : (system?.pod.state ?? 'unknown')}
          </span>
          <span>
            {system?.controllerAvailable ? 'Live · updates every 2 seconds' : 'Saved checkpoint'}
          </span>
        </div>
        <h2>Provider scores</h2>
        <div className="data-scroll">
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Current score</th>
                <th>Answers</th>
                <th>Status</th>
                <th>Known API cost</th>
                <th>Response time</th>
              </tr>
            </thead>
            <tbody>
              {systems.map((name) => {
                const row = rows.find((r) => r.system === name),
                  timing = metrics?.timing.find(
                    (t) => t.variantId === row?.variantId && t.stage === 'answer',
                  );
                const total = row?.completedCount ?? 0;
                const processing =
                  !queueView &&
                  system?.controllerAvailable &&
                  snapshot?.state === 'running' &&
                  tasks.some(
                    (t) =>
                      t.variantId === row?.variantId &&
                      ['leased', 'submitted', 'running'].includes(t.state),
                  );
                const check = system?.readiness?.checks.find(
                  (c) => c.system === name && (!row?.logicalModel || c.model === row.logicalModel),
                );
                const working =
                  row &&
                  Object.entries(row.stateCounts).some(
                    ([k, n]) => ['running', 'submitted', 'leased'].includes(k) && n > 0,
                  );
                const state = !row
                  ? queueView
                    ? queueLabel
                    : 'Not in this run'
                  : row.blockedCount
                    ? `${row.blockedCount} blocked`
                    : total === row.plannedCount
                      ? 'Complete'
                      : working
                        ? 'Answering'
                        : snapshot?.state === 'running'
                          ? 'Preparing / queued'
                          : (snapshot?.state ?? 'Waiting');
                return (
                  <tr key={name}>
                    <td>
                      <strong>
                        {processing && (
                          <span
                            className="provider-ping"
                            role="status"
                            aria-label={`${name} processing`}
                            title="Processing video or answering"
                          />
                        )}
                        {
                          {
                            larkup: 'Larkup video tool',
                            gemini: 'Gemini',
                            qwen: 'Qwen',
                            muse: 'Meta Muse Spark',
                            minimax: 'MiniMax',
                            twelvelabs: 'TwelveLabs',
                          }[name]
                        }
                      </strong>
                      {row?.logicalModel && <div className="note">{row.logicalModel}</div>}
                      {check && (
                        <div className="note" title={check.note}>
                          Last API check: {check.state}
                        </div>
                      )}
                    </td>
                    <td className="home-score">
                      {row?.accuracy.value == null
                        ? '—'
                        : `${Math.round(row.accuracy.value * 100)}%`}
                      <div className="note">
                        {total
                          ? `${row?.correctCount} correct / ${total} answered`
                          : 'No scored answers yet'}
                      </div>
                    </td>
                    <td>
                      {total} / {row?.plannedCount ?? '—'}
                    </td>
                    <td>{state}</td>
                    <td>
                      {row?.cost.actual == null ? 'Unknown' : fmtMoney(row.cost.actual, 'USD')}
                      {!!row?.cost.unknownAttemptCount && (
                        <div className="note">{row.cost.unknownAttemptCount} unknown charges</div>
                      )}
                    </td>
                    <td>{timing?.p50Ms == null ? '—' : fmtDuration(timing.p50Ms)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="note">
          Scores use answered questions only. Different answer counts are not a fair ranking.
          Blocked API calls are not wrong answers. Retrieval ablation, logs, database and full
          exports are in Advanced.
        </p>
        {system?.readiness && (
          <p className="note">
            Service checks: {new Date(system.readiness.checkedAt).toLocaleString()}.{' '}
            {system.readiness.limitations.join(' ')}
          </p>
        )}
        {snapshot && (
          <div className="controls">
            <a href={api.csvUrl(snapshot.id)}>Download CSV</a>
            <a href={`/api/v1/runs/${encodeURIComponent(snapshot.id)}/exports/results.json`}>
              Download JSON
            </a>
          </div>
        )}
      </section>
    </>
  );
}
