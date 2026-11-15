'use client';
import { useEffect, useState } from 'react';
import type { RunSummary, RunSnapshot, RunMetrics, TaskObject } from '../lib/contract.js';
import { operate, type SystemStatus, type Operation } from '../lib/operator.js';
import { providerActivity, retryCountdown } from '../lib/activity.js';
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
  onOperation,
}: {
  runs: RunSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
  snapshot: RunSnapshot | null;
  metrics: RunMetrics | null;
  tasks: TaskObject[];
  system: SystemStatus | null;
  operatorEnabled: boolean;
  onOperation: (operation: Operation) => void;
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
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!pending?.startup?.nextRetryAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending?.startup?.nextRetryAt]);
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
      onOperation(op);
      if (name === 'new-run') setShowQueue(true);
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
        {queueView && (
          <div className="banner startup-request" role="status">
            <strong>
              <span className="provider-dot warn" aria-hidden="true" />
              New benchmark · {queueLabel}
            </strong>
            <div className="note">Request {queued.id}</div>
            <p>
              {queued.startup?.phase === 'waiting_capacity'
                ? 'Your request is saved. The saved GPU host has no available capacity. The benchmark will start automatically when capacity returns.'
                : 'Your request is saved. Starting GPU and benchmark services; the experiment will open here automatically.'}
            </p>
            <span>No new answers yet. You can browse earlier experiments while waiting.</span>
          </div>
        )}
        {pending && (
          <p role="status">
            {pending.stage ?? 'Preparing benchmark services…'}
            {pending.startup?.nextRetryAt && (
              <>
                {' '}
                Attempt {pending.startup.attempt}. Next attempt:{' '}
                {new Date(pending.startup.nextRetryAt).toLocaleTimeString()} (
                {retryCountdown(pending.startup.nextRetryAt, now)}).
              </>
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
        <p className="note">
          Orange: waiting / preparing · Pulsing green: processing · Green: complete · Gray: inactive
          / saved checkpoint
        </p>
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
                const activity = providerActivity({
                  row,
                  runState: snapshot?.state,
                  live: system?.controllerAvailable === true,
                  tasks,
                  queueLabel: queueView ? queueLabel : undefined,
                });
                const check = system?.readiness?.checks.find(
                  (c) => c.system === name && (!row?.logicalModel || c.model === row.logicalModel),
                );
                return (
                  <tr key={name}>
                    <td>
                      <strong>
                        <span
                          className={`provider-dot ${activity.tone}${activity.pulse ? ' pulsing' : ''}`}
                          role="img"
                          aria-label={`${name}: ${activity.label}`}
                          title={activity.label}
                        />
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
                    <td>{activity.label}</td>
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
