'use client';
import { gpuServicesReady } from '../lib/gpu-status.js';
import { useEffect, useState, useRef } from 'react';
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
  const [dismissedOffer, setDismissedOffer] = useState<string | null>(null);
  const [offerError, setOfferError] = useState('');
  const choosingOffer = useRef(false);
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
  useEffect(() => {
    if (['completed', 'failed', 'cancelled'].includes(latest?.state ?? '')) setMessage('');
  }, [latest?.id, latest?.state]);
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
  async function gpuChoice(selection: string) {
    if (!system?.gpuOffers || choosingOffer.current) return;
    const offer = system.gpuOffers;
    choosingOffer.current = true;
    setOfferError('');
    setBusy(true);
    try {
      const response = await fetch('/api/v1/system/gpu-choice', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ offerId: offer.id, selection }),
      });
      const body = await response.json();
      if (!response.ok)
        throw Error(
          body.error?.code === 'GPU_OFFER_EXPIRED'
            ? 'This price offer expired. Updated offers will appear automatically; please choose again.'
            : (body.error?.message ?? 'GPU selection failed. Please try again.'),
        );
      setDismissedOffer(offer.id);
      setMessage(selection === 'wait' ? 'Waiting for cheaper offers; no GPU reserved.' : '');
    } catch (e) {
      setOfferError(e instanceof Error ? e.message : String(e));
    } finally {
      choosingOffer.current = false;
      setBusy(false);
    }
  }
  const rows = metrics?.summary?.filter((r) => r.system !== 'retrieval') ?? [];
  const systems = ['larkup', 'gemini', 'qwen', 'muse', 'minimax', 'twelvelabs'] as const;
  return (
    <>
      {system?.gpuOffers && system.gpuOffers.id !== dismissedOffer && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Choose GPU">
          <div className="modal-card">
            <h3>Choose a GPU</h3>
            {offerError && <p role="alert">{offerError}</p>}
            {busy && <p role="status">Confirming your choice…</p>}
            <p>
              Listed availability can change. Only your chosen GPU will be reserved. Storage is
              billed separately.
            </p>
            {system.gpuOffers.offers.map((offer, index) => (
              <p key={index}>
                {offer.gpuTypeId} · {offer.cloudType} · USD {offer.quotedHourlyUsd}/hour{' '}
                <button disabled={busy} onClick={() => gpuChoice(String(index))}>
                  Accept this GPU
                </button>
              </p>
            ))}
            <button disabled={busy} onClick={() => gpuChoice('wait')}>
              Wait for a cheaper GPU
            </button>
          </div>
        </div>
      )}

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
        {message && !pending && <p role="status">{message}</p>}
        {queueView && (
          <div className="banner startup-request" role="status">
            <strong>
              <span className="provider-dot warn" aria-hidden="true" />
              New benchmark · {queueLabel}
            </strong>
            <div className="note">Request {queued.id}</div>
            <p>
              {queued.startup?.phase === 'waiting_capacity'
                ? 'Your request is saved. Checking the saved GPU host and compatible alternatives within the configured price cap. The benchmark starts after data and services are ready.'
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
            {pending?.stage ??
              (pending?.startup?.phase === 'waiting_capacity'
                ? 'Waiting for capacity'
                : pending?.startup?.phase === 'starting_gpu'
                  ? 'Waking up'
                  : (system?.pod.state ?? 'unknown'))}
          </span>
          <span>
            {system?.pod.state === 'RUNNING' && gpuServicesReady(system.services)
              ? 'Live · updates every 2 seconds'
              : 'Saved checkpoint'}
          </span>
        </div>
        {snapshot && (
          <div className={`banner ${snapshot.state === 'blocked' ? 'error' : ''}`} role="status">
            <strong>
              {snapshot.phase === 'smoke'
                ? 'Step 1: Service check'
                : snapshot.phase === 'pilot'
                  ? 'Step 2: Benchmark comparison'
                  : `${snapshot.phase} experiment`}
              {' · '}
              {snapshot.coverage.plannedQuestions} questions per participating provider
              {' · '}
              {snapshot.coverage.plannedVariants} configurations
            </strong>
            {snapshot.phase === 'smoke' && (
              <p>
                This is a short readiness check, not the full comparison. Only providers needing
                verification participate. The full comparison starts only after every required
                provider passes; answers below count this check only.
              </p>
            )}
            {snapshot.state === 'blocked' && (
              <p>
                Stopped: a service needs attention. Nothing is processing in this experiment. Fix
                the service errors before starting another benchmark.
              </p>
            )}
            {!!snapshot.blockers.length && (
              <ul>
                {snapshot.blockers.map((issue, index) => (
                  <li key={`${issue.code}-${issue.scopeId}-${index}`}>
                    {issue.scopeId ? `${issue.scopeId}: ` : ''}
                    {issue.message} ({issue.code})
                  </li>
                ))}
              </ul>
            )}
            {snapshot.phase === 'smoke' && runs.some((run) => run.phase === 'pilot') && (
              <button onClick={() => onSelect(runs.find((run) => run.phase === 'pilot')!.id)}>
                View earlier comparison
              </button>
            )}
          </div>
        )}
        <h2>{snapshot?.phase === 'smoke' ? 'Service check results' : 'Provider scores'}</h2>
        <p className="note">
          Orange: queued / waiting · Pulsing green: processing · Green: complete · Red: blocked /
          failed · Gray: not participating or paused. Saved results keep their completion/error
          colors.
        </p>
        <div className="data-scroll">
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Current score</th>
                <th>Answered / planned in this stage</th>
                <th>Status</th>
                <th>Known API cost</th>
                <th>Indexing / preparation time</th>
                <th>Response time</th>
              </tr>
            </thead>
            <tbody>
              {systems.map((name) => {
                const row = rows.find((r) => r.system === name),
                  timing = metrics?.timing.find(
                    (t) => t.variantId === row?.variantId && t.stage === 'answer',
                  );
                const indexing = metrics?.timing.find(
                  (t) => t.variantId === row?.variantId && t.stage === 'index',
                );
                const preparation = metrics?.timing.find(
                  (t) => t.variantId === row?.variantId && t.stage === 'preparation',
                );
                const setup = indexing?.p50Ms != null ? indexing : preparation;
                const total = row?.completedCount ?? 0;
                const activity =
                  !metrics && !queueView
                    ? { label: 'Loading provider results…', tone: 'idle', pulse: false }
                    : providerActivity({
                        row,
                        runState: snapshot?.state,
                        live: system?.controllerAvailable === true,
                        tasks,
                        queueLabel: queueView ? queueLabel : undefined,
                      });
                const preparationTasks = tasks.filter(
                  (t) => t.variantId === row?.variantId && !t.questionId,
                );
                const preparationDone = preparationTasks.filter(
                  (t) => t.state === 'completed',
                ).length;
                const progress = preparationTasks.find((t) =>
                  ['leased', 'submitted', 'running'].includes(t.state),
                )?.progress;
                const preparationMessage =
                  progress &&
                  typeof progress === 'object' &&
                  'message' in progress &&
                  typeof progress.message === 'string'
                    ? progress.message
                    : null;
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
                      {!metrics
                        ? 'Loading results…'
                        : row
                          ? `${total} / ${row.plannedCount}`
                          : 'Not participating'}
                    </td>
                    <td>
                      <strong>{activity.label}</strong>
                      {preparationTasks.length > 0 && (
                        <div className="note">
                          Videos prepared: {preparationDone} / {preparationTasks.length}
                        </div>
                      )}
                      {preparationMessage && <div className="note">{preparationMessage}</div>}
                      {row &&
                        (() => {
                          const issues = tasks.filter(
                            (task) => task.variantId === row.variantId && task.issue,
                          );
                          const issue =
                            issues.find((task) => task.issue?.code !== 'DEPENDENCY_BLOCKED')
                              ?.issue ?? issues[0]?.issue;
                          return issue ? (
                            <div className="note">
                              {issue.message} ({issue.code})
                            </div>
                          ) : null;
                        })()}
                    </td>
                    <td>
                      {row?.cost.actual == null ? 'Unknown' : fmtMoney(row.cost.actual, 'USD')}
                      {row?.cost.estimated != null && (
                        <div className="note">
                          List-price estimate: {fmtMoney(row.cost.estimated, 'USD')} · may exclude
                          unreported usage
                        </div>
                      )}
                      {!!row?.cost.unknownAttemptCount && (
                        <div className="note">{row.cost.unknownAttemptCount} unknown charges</div>
                      )}
                    </td>
                    <td>
                      {setup?.p50Ms == null ? '—' : fmtDuration(setup.p50Ms)}
                      <div className="note">
                        {indexing?.p50Ms != null
                          ? 'Index build · median per video'
                          : preparation?.p50Ms != null
                            ? 'Preparation · no separate index'
                            : 'No completed setup measurement'}
                        {!!setup?.reusedCount &&
                          ` · ${setup.reusedCount} reused (original build time)`}
                      </div>
                    </td>
                    <td>
                      {timing?.p50Ms == null ? '—' : fmtDuration(timing.p50Ms)}
                      <div className="note">Median per answer · excludes source setup</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="note">
          Source setup is recorded once per video; each answer has its own response time. Accuracy =
          correct answers / answered questions. A failed API call is a service failure, not an
          incorrect answer. Compare accuracy only on the same completed questions. Service checks
          verify responses, independently of answer correctness. Advanced has detailed logs,
          database inspection and exports.
        </p>
        {system?.readiness && (
          <p className="note">
            Most recent functional checks (separate from this experiment):{' '}
            {new Date(system.readiness.checkedAt).toLocaleString()}.{' '}
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
