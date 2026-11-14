'use client';
import { useState } from 'react';
import type { RunSummary, RunSnapshot, RunMetrics } from '../lib/contract.js';
import { operate, type SystemStatus } from '../lib/operator.js';
import { fmtMoney, fmtDuration } from '../lib/format.js';
import { api } from '../lib/client.js';

export function Home({
  runs,
  selected,
  onSelect,
  snapshot,
  metrics,
  system,
  operatorEnabled,
}: {
  runs: RunSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
  snapshot: RunSnapshot | null;
  metrics: RunMetrics | null;
  system: SystemStatus | null;
  operatorEnabled: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const pending = system?.operations.find((o) => ['pending', 'running'].includes(o.state));
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
        `${name === 'new-run' ? 'New benchmark' : name === 'resume-run' ? 'Resume selected run' : name} accepted. Starting services can take a few minutes.`,
      );
      if (op.result?.runId) onSelect(op.result.runId);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const rows = metrics?.summary?.filter((r) => r.system !== 'retrieval') ?? [];
  const systems = ['larkup', 'gemini', 'qwen', 'twelvelabs'] as const;
  return (
    <>
      <section className="panel">
        <h2>Your benchmark</h2>
        <label htmlFor="selected-run">Experiment </label>
        <select id="selected-run" value={selected ?? ''} onChange={(e) => onSelect(e.target.value)}>
          {!runs.length && <option value="">No experiments yet</option>}
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
          New benchmark creates a separate experiment. Resume continues only the selected experiment
          and keeps its completed answers.
        </p>
        {message && <p role="status">{message}</p>}
        {pending && <p role="status">{pending.stage ?? 'Preparing benchmark services…'}</p>}
        {latest?.state === 'failed' && (
          <p className="banner error">
            {latest.issue?.message ?? 'The last operation failed. See Advanced → Events.'}
          </p>
        )}
      </section>
      <section className="panel">
        <div className="home-status">
          <strong>{snapshot?.state ?? 'No run selected'}</strong>
          <span>GPU: {system?.pod.state ?? 'unknown'}</span>
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
                const check = system?.readiness?.checks.find((c) => c.system === name);
                const working =
                  row &&
                  Object.entries(row.stateCounts).some(
                    ([k, n]) => ['running', 'submitted', 'leased'].includes(k) && n > 0,
                  );
                const state = !row
                  ? 'Not in this run'
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
                        {
                          {
                            larkup: 'Larkup video tool',
                            gemini: 'Gemini',
                            qwen: 'Qwen',
                            twelvelabs: 'TwelveLabs',
                          }[name]
                        }
                      </strong>
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
