'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Home } from './Home.js';
import { read, type SystemStatus } from '../lib/operator.js';
import { api, type PublicMeta } from '../lib/client.js';
import { ControlCenter, DatabaseTab, RecordsTab, LogsTab, ServicesTab } from './ControlCenter.js';
import {
  type ControllerEvent,
  type ProviderScope,
  type ResultObject,
  type RunMetrics,
  type RunSnapshot,
  type RunSummary,
  type TaskObject,
} from '../lib/contract.js';
import {
  allowedControls,
  fmtAccuracy,
  fmtDuration,
  fmtMoney,
  fmtPercent,
  fmtTime,
  relTime,
  STATE_TONE,
} from '../lib/format.js';

const POLL_MS = 2000;
const MAX_EVENTS = 40;

type Loaded = {
  snapshot: RunSnapshot;
  metrics: RunMetrics | null;
  tasks: TaskObject[];
  results: ResultObject[];
};

export default function Dashboard() {
  const [tab, setTab] = useState('Home');
  const [live, setLive] = useState(false);
  const onLive = useCallback((available: boolean) => setLive(available), []);
  const [meta, setMeta] = useState<PublicMeta | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [data, setData] = useState<Loaded | null>(null);
  const [scopes, setScopes] = useState<ProviderScope[]>([]);
  const [events, setEvents] = useState<ControllerEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const seenEvents = useRef<Set<string>>(new Set());
  const cursorRef = useRef<string | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const followedRun = useRef<string | null>(null);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  useEffect(() => {
    if (meta?.mode !== 'proxy') return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const status = await read<SystemStatus>('/system');
        if (cancelled) return;
        setSystem(status);
        setLive(status.controllerAvailable);
        if (status.selectedRunId && status.selectedRunId !== followedRun.current) {
          followedRun.current = status.selectedRunId;
          setSelected(status.selectedRunId);
        }
      } catch {
        if (!cancelled) setLive(false);
      }
    };
    void refresh();
    const timer = setInterval(refresh, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [meta?.mode]);

  // Initial meta + run list.
  useEffect(() => {
    (async () => {
      try {
        const [m, r] = await Promise.all([api.meta(), api.runs()]);
        setMeta(m);
        setRuns(r.items);
        setSelected(
          (prev) =>
            prev ??
            new URLSearchParams(window.location.search).get('run') ??
            r.items.find((x) => x.state === 'running')?.id ??
            r.items[0]?.id ??
            null,
        );
      } catch (e) {
        setError(describe(e));
      }
    })();
  }, []);

  const loadSelected = useCallback(async (id: string, isPoll: boolean) => {
    try {
      const [snapshot, metrics, tasks, results, scopeList] = await Promise.all([
        api.run(id),
        api.metrics(id).catch(() => null),
        api
          .tasks(id)
          .then((p) => p.items)
          .catch(() => [] as TaskObject[]),
        api
          .results(id)
          .then((p) => p.items)
          .catch(() => [] as ResultObject[]),
        api
          .providerScopes()
          .then((p) => p.items)
          .catch(() => [] as ProviderScope[]),
      ]);
      if (selectedRef.current !== id) return;
      // Defensive: a live controller may omit empty arrays. Never let a missing
      // field crash a panel (which would leave the page stuck on "Loading run…").
      const safeMetrics = metrics
        ? {
            ...metrics,
            accuracy: metrics.accuracy ?? [],
            paired: metrics.paired ?? [],
            timing: metrics.timing ?? [],
            providerUsage: metrics.providerUsage ?? [],
          }
        : null;
      setData({ snapshot, metrics: safeMetrics, tasks: tasks ?? [], results: results ?? [] });
      setScopes(scopeList ?? []);
      setError(null);

      // Events: poll from cursor, dedupe by id, cap list.
      const page = await api.events(id, cursorRef.current).catch(() => null);
      if (page && selectedRef.current === id) {
        const fresh = page.events.filter((e) => !seenEvents.current.has(e.id));
        fresh.forEach((e) => seenEvents.current.add(e.id));
        if (fresh.length) setEvents((prev) => [...fresh.reverse(), ...prev].slice(0, MAX_EVENTS));
        cursorRef.current = page.nextCursor;
      }
      void isPoll;
    } catch (e) {
      // Surface the failure instead of sitting silently on the spinner.
      if (selectedRef.current !== id) return;
      console.error('[dashboard] loadSelected failed for', id, e);
      setError(describe(e));
    }
  }, []);

  // Reset per-run event state when selection changes.
  useEffect(() => {
    if (!selected) return;
    seenEvents.current = new Set();
    cursorRef.current = null;
    setEvents([]);
    setData(null);
    loadSelected(selected, false);
  }, [selected, loadSelected]);

  // Polling loop (2s) — short polling per the contract's initial transport.
  useEffect(() => {
    if (!selected) return;
    const live =
      data?.snapshot && ['running', 'pausing', 'cancelling'].includes(data.snapshot.state);
    const interval = setInterval(() => loadSelected(selected, true), live ? POLL_MS : POLL_MS * 2);
    return () => clearInterval(interval);
  }, [selected, data?.snapshot?.state, loadSelected]);

  const refreshRuns = useCallback(async () => {
    try {
      setRuns((await api.runs()).items);
    } catch {
      /* ignore */
    }
  }, []);

  const onControl = useCallback(
    async (op: 'start' | 'pause' | 'resume' | 'cancel') => {
      if (
        !data?.snapshot ||
        !(meta?.mode === 'proxy' ? live && meta.operatorEnabled : meta?.writesEnabled)
      )
        return;
      setBusy(op);
      setNotice(null);
      try {
        const snap = await api.control(op, data.snapshot.id, data.snapshot.revision);
        setData((d) => (d ? { ...d, snapshot: snap } : d));
        setNotice(`${op} accepted → ${snap.state} (revision ${snap.revision}).`);
        await Promise.all([refreshRuns(), loadSelected(data.snapshot.id, true)]);
      } catch (e) {
        const err = e as { status?: number; code?: string; message?: string };
        if (err.status === 409) {
          setNotice(
            `Conflict (${err.code ?? '409'}): ${err.message ?? 'state changed'} — refreshing.`,
          );
          await loadSelected(data.snapshot.id, true);
        } else {
          setNotice(`${op} failed: ${describe(e)}`);
        }
      } finally {
        setBusy(null);
      }
    },
    [data?.snapshot, meta, live, refreshRuns, loadSelected],
  );

  useEffect(() => {
    const timer = setInterval(refreshRuns, 3000);
    return () => clearInterval(timer);
  }, [refreshRuns]);

  const snap = data?.snapshot;
  const writesEnabled =
    meta?.mode === 'proxy' ? live && meta.operatorEnabled === true : (meta?.writesEnabled ?? false);

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <h1>Video Benchmark Dashboard</h1>
          <div className="sub">Controller API v1 · local{snap ? ` · ${snap.phase} phase` : ''}</div>
        </div>
        <ThemeToggle />
      </header>

      {(meta?.mode === 'offline' || (meta?.mode === 'proxy' && !live)) && (
        <div className="banner offline">
          <strong>Saved data — readonly.</strong> Showing the last-synced export; controller
          availability is not a guarantee of GPU state. Run writes are disabled and figures may be
          stale. Operator controls can reconnect the saved GPU when enabled.{' '}
          {meta?.lastSyncedAt
            ? ` Checkpoint: ${new Date(meta.lastSyncedAt).toLocaleString()}.`
            : ''}
        </div>
      )}
      {meta?.mode === 'mock' && (
        <div className="banner mock">
          <strong>Mock mode.</strong> All figures are illustrative contract fixtures, not measured
          results. Set <code>DASHBOARD_MODE=proxy</code> with a controller URL to use the live
          backend.
        </div>
      )}
      {error && (
        <div className="banner error">
          <strong>Error:</strong> {error}
        </div>
      )}

      <div className={tab === 'Home' ? 'home-layout' : 'layout'}>
        {tab !== 'Home' && (
          <aside>
            <div className="panel">
              <h2>Runs</h2>
              <ul className="runlist">
                {runs.map((r) => (
                  <li key={r.id}>
                    <button
                      className={r.id === selected ? 'active' : ''}
                      onClick={() => setSelected(r.id)}
                    >
                      <div className="rid">{r.id}</div>
                      <div className="rmeta">
                        <Badge tone={STATE_TONE[r.state]}>{r.state}</Badge>{' '}
                        {r.decision !== 'not_evaluated' ? `· ${r.decision}` : ''} ·{' '}
                        {relTime(r.updatedAt)}
                      </div>
                    </button>
                  </li>
                ))}
                {!runs.length && <li className="muted">No runs.</li>}
              </ul>
            </div>
          </aside>
        )}

        <main>
          <nav className="tabs" aria-label="Main views">
            <button onClick={() => setTab('Home')} aria-pressed={tab === 'Home'}>
              Home
            </button>
            <button onClick={() => setTab('Overview')} aria-pressed={tab !== 'Home'}>
              Advanced
            </button>
          </nav>
          {tab === 'Home' && (
            <Home
              runs={runs}
              selected={selected}
              onSelect={setSelected}
              snapshot={snap ?? null}
              metrics={data?.metrics ?? null}
              system={system}
              operatorEnabled={meta?.operatorEnabled === true}
            />
          )}
          {tab !== 'Home' && <ControlCenter enabled={meta?.mode === 'proxy'} onLive={onLive} />}
          {tab !== 'Home' && (
            <nav className="tabs" aria-label="Benchmark views" role="tablist">
              {[
                'Overview',
                'Processes',
                'Results',
                'Logs',
                'Database',
                'Services & providers',
                'Events',
              ].map((name) => (
                <button
                  key={name}
                  role="tab"
                  aria-selected={tab === name}
                  aria-controls="benchmark-tab-panel"
                  onClick={() => setTab(name)}
                >
                  {name}
                </button>
              ))}
            </nav>
          )}
          <div id="benchmark-tab-panel" role="tabpanel" aria-label={tab}>
            {tab === 'Processes' && <RecordsTab runId={selected} kind="tasks" />}
            {tab === 'Results' && <RecordsTab runId={selected} kind="results" />}
            {tab === 'Logs' && <LogsTab />}
            {tab === 'Database' && <DatabaseTab runId={selected} />}
            {tab === 'Services & providers' && <ServicesTab scopes={scopes} />}
            {tab === 'Events' && <EventsPanel events={events} />}
            {tab === 'Overview' && !snap && !error && (
              <div className="panel">
                <span className="spin" /> Loading run{selected ? ` ${selected}` : ''}…
                <div className="note">
                  If this persists, hard-reload (Cmd/Ctrl+Shift+R). Still stuck? Open DevTools →
                  Console and share the red error.
                </div>
              </div>
            )}
            {tab === 'Overview' && !snap && !error && !selected && runs.length === 0 && (
              <div className="note">No runs returned by the controller yet.</div>
            )}

            {tab === 'Overview' && snap && (
              <>
                <RunHeaderPanel
                  snap={snap}
                  plannedCells={data!.metrics?.plannedCount}
                  writesEnabled={writesEnabled}
                  busy={busy}
                  notice={notice}
                  onControl={onControl}
                  csvUrl={api.csvUrl(snap.id)}
                />
                <ProgressPanel tasks={data!.tasks.slice(0, 8)} counts={snap.taskCounts} />
                <p className="note">
                  Overview shows up to 8 tasks. Open Processes for all rows and attempt details.
                </p>
                <AccuracyPanel metrics={data!.metrics} />
                <CostPanel snap={snap} metrics={data!.metrics} scopes={scopes} />
                <TimingPanel metrics={data!.metrics} />
                <IssuesPanel snap={snap} tasks={data!.tasks} />
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function RunHeaderPanel({
  snap,
  plannedCells,
  writesEnabled,
  busy,
  notice,
  onControl,
  csvUrl,
}: {
  snap: RunSnapshot;
  plannedCells?: number;
  writesEnabled: boolean;
  busy: string | null;
  notice: string | null;
  onControl: (op: 'start' | 'pause' | 'resume' | 'cancel') => void;
  csvUrl: string;
}) {
  const allowed = allowedControls(snap.state);
  const btn = (op: 'start' | 'pause' | 'resume' | 'cancel', danger = false) => (
    <button
      className={danger ? 'danger' : ''}
      disabled={!writesEnabled || !allowed.includes(op) || busy !== null}
      onClick={() => onControl(op)}
      title={
        !writesEnabled
          ? 'Writes disabled (offline/readonly)'
          : !allowed.includes(op)
            ? `Not allowed in state ${snap.state}`
            : ''
      }
    >
      {busy === op ? <span className="spin" /> : null} {cap(op)}
    </button>
  );
  return (
    <div className="panel">
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <div className="mono">
            {snap.id}{' '}
            <span className="muted">
              · rev {snap.revision} · cursor {snap.eventCursor}
            </span>
          </div>
          <div style={{ marginTop: 4 }}>
            <Badge tone={STATE_TONE[snap.state]}>{snap.state}</Badge>{' '}
            <Badge
              tone={
                snap.decision === 'stop' ? 'bad' : snap.decision === 'continue' ? 'done' : 'idle'
              }
            >
              decision: {snap.decision}
            </Badge>
          </div>
        </div>
        <div className="controls">
          {btn('start')}
          {btn('pause')}
          {btn('resume')}
          {btn('cancel', true)}
          <a className="btn-link" href={csvUrl} download>
            Export CSV
          </a>
        </div>
      </div>
      {notice && <div className="note">{notice}</div>}
      <div className="kv" style={{ marginTop: 12 }}>
        <Cell k="Dataset manifest" v={<span className="mono">{snap.datasetManifestId}</span>} />
        <Cell k="Config revision" v={<span className="mono">{snap.configRevision}</span>} />
        <Cell k="Protocol" v={<span className="mono">{snap.protocolRevision}</span>} />
        <Cell k="Started" v={<small>{fmtTime(snap.startedAt)}</small>} />
        <Cell
          k="Updated"
          v={
            <small>
              {fmtTime(snap.updatedAt)} ({relTime(snap.updatedAt)})
            </small>
          }
        />
        <Cell
          k="Completed answer cells"
          v={
            <>
              {snap.coverage.completedPairs}
              <small>{plannedCells != null ? ` / ${plannedCells} planned` : ' completed'}</small>
            </>
          }
        />
      </div>
      {!writesEnabled && (
        <div className="note">Controls are disabled: the dashboard is readonly in this mode.</div>
      )}
    </div>
  );
}

function ProgressPanel({
  tasks,
  counts,
}: {
  tasks: TaskObject[];
  counts: RunSnapshot['taskCounts'];
}) {
  const byProvider = useMemo(() => {
    const m = new Map<string, TaskObject[]>();
    for (const t of tasks) {
      const provider = t.provider ?? 'Not dispatched';
      (m.get(provider) ?? m.set(provider, []).get(provider)!).push(t);
    }
    return [...m.entries()];
  }, [tasks]);

  return (
    <div className="panel">
      <h2>Progress by provider / source</h2>
      <div className="kv" style={{ marginBottom: 12 }}>
        {Object.entries(counts).map(([state, n]) => (
          <Cell key={state} k={state} v={String(n)} />
        ))}
        {!Object.keys(counts).length && <Cell k="tasks" v="—" />}
      </div>
      {byProvider.length === 0 ? (
        <p className="muted">No active tasks for this run (completed or draft).</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Source</th>
              <th>Variant</th>
              <th>Group</th>
              <th>Route · tier</th>
              <th>State</th>
              <th>Progress</th>
              <th>Issue</th>
            </tr>
          </thead>
          <tbody>
            {byProvider.flatMap(([provider, list]) =>
              list.map((t) => (
                <tr key={t.taskId}>
                  <td className="nowrap">
                    {provider}
                    <div className="muted mono">{t.accountAlias}</div>
                  </td>
                  <td className="mono nowrap">
                    {t.sourceId}
                    <div className="muted">{t.dataset}</div>
                  </td>
                  <td className="mono">{t.variantId}</td>
                  <td>{t.durationGroup}</td>
                  <td className="nowrap">
                    <span className="tag">{t.routeId}</span>
                  </td>
                  <td>
                    <Badge tone={taskTone(t.state)}>{t.state}</Badge>
                  </td>
                  <td>
                    <ProgressBar state={t.state} stage={t.stage} percent={t.percent} />
                  </td>
                  <td>
                    {t.issue ? (
                      <IssueInline code={t.issue.code} msg={t.issue.message} />
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      )}
      <div className="note">
        A task reaching 100% is not the whole run completing. Unknown progress is shown as
        indeterminate.
      </div>
    </div>
  );
}

function AccuracyPanel({ metrics }: { metrics: RunMetrics | null }) {
  if (!metrics)
    return (
      <div className="panel">
        <h2>Accuracy</h2>
        <p className="muted">No metrics.</p>
      </div>
    );
  const variants = [...new Set(metrics.accuracy.map((a) => a.variantId))];
  const groups: Array<'short' | 'medium' | 'long' | 'all'> = ['short', 'medium', 'long', 'all'];
  const cell = (variant: string, group: string) =>
    metrics.accuracy.find((a) => a.variantId === variant && a.durationGroup === group);

  return (
    <div className="panel">
      <h2>
        Accuracy by variant &amp; duration group{' '}
        {metrics.partial && <Badge tone="warn">partial</Badge>}
      </h2>
      <table>
        <thead>
          <tr>
            <th>Variant</th>
            {groups.map((g) => (
              <th key={g} className="num">
                {g}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {variants.map((v) => (
            <tr key={v}>
              <td className="mono">{v}</td>
              {groups.map((g) => {
                const a = cell(v, g);
                if (!a)
                  return (
                    <td key={g} className="num na">
                      n/a
                    </td>
                  );
                return (
                  <td key={g} className="num">
                    <div>{fmtAccuracy(a.accuracy, a.denominator)}</div>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {a.correctCount}/{a.denominator}
                      {a.blockedCount > 0 && (
                        <span className="issue"> · {a.blockedCount} blocked</span>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
          {!variants.length && (
            <tr>
              <td colSpan={groups.length + 1} className="muted">
                No completed answers yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {metrics.paired.length > 0 && (
        <>
          <h3>Paired wins / losses (same completed source cohort)</h3>
          <table>
            <thead>
              <tr>
                <th>Comparison</th>
                <th className="num">Wins</th>
                <th className="num">Losses</th>
                <th className="num">Ties</th>
                <th className="num">Sources</th>
                <th className="num">Denom.</th>
              </tr>
            </thead>
            <tbody>
              {metrics.paired.map((p, i) => (
                <tr key={i}>
                  <td className="mono">
                    {p.variantA} <span className="muted">vs</span> {p.variantB}
                  </td>
                  <td className="num">{p.wins}</td>
                  <td className="num">{p.losses}</td>
                  <td className="num">{p.ties}</td>
                  <td className="num">{p.comparedSourceCount}</td>
                  <td className="num">{p.denominator}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <div className="note">
        Accuracy is always shown with its denominator. Blocked / unevaluated cells are never counted
        as wrong.
      </div>
    </div>
  );
}

function CostPanel({
  snap,
  metrics,
  scopes,
}: {
  snap: RunSnapshot;
  metrics: RunMetrics | null;
  scopes: ProviderScope[];
}) {
  const c = snap.cost;
  return (
    <div className="panel">
      <h2>Cost &amp; allowance</h2>
      <div className="kv">
        <Cell k="Actual (cash)" v={fmtMoney(c.actual, c.currency)} />
        <Cell
          k="Estimated"
          v={
            <>
              {fmtMoney(c.estimated, c.currency)} <small>not additive</small>
            </>
          }
        />
        <Cell k="Unknown attempts" v={String(c.unknownAttemptCount)} />
        <Cell k="Reconciled" v={c.reconciled ? 'yes' : <span className="issue">pending</span>} />
      </div>

      {metrics && metrics.providerUsage.length > 0 && (
        <>
          <h3>Per-provider usage (cash vs free allowance kept separate)</h3>
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Account</th>
                <th className="num">Cash</th>
                <th className="num">Free allowance</th>
                <th className="num">List-price eq.</th>
              </tr>
            </thead>
            <tbody>
              {metrics.providerUsage.map((u, i) => (
                <tr key={i}>
                  <td>{u.provider}</td>
                  <td className="mono">{u.accountAlias}</td>
                  <td className="num">{fmtMoney(u.cashSpent, u.currency)}</td>
                  <td className="num">
                    {u.freeAllowanceConsumed ?? <span className="muted">—</span>}
                  </td>
                  <td className="num muted">
                    {u.listPriceEquivalent ? fmtMoney(u.listPriceEquivalent, u.currency) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h3>Provider scopes (balance / quota / route health)</h3>
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Tier</th>
            <th>Balance</th>
            <th>Free allowance</th>
            <th>Quota</th>
            <th>Cooldown</th>
            <th>Route</th>
          </tr>
        </thead>
        <tbody>
          {scopes.map((s) => (
            <tr key={s.id}>
              <td>
                {s.provider}
                <div className="muted mono">{s.accountAlias}</div>
              </td>
              <td>{s.tier}</td>
              <td>
                {s.balance ? (
                  fmtMoney(s.balance, s.balanceCurrency ?? 'USD')
                ) : (
                  <span className="na" title={s.balanceReason ?? ''}>
                    {s.balanceReason ? 'n/a' : 'unknown'}
                  </span>
                )}
              </td>
              <td>
                {s.freeAllowanceRemaining ? (
                  `${s.freeAllowanceRemaining} ${s.freeAllowanceUnit ?? ''}`
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td>
                <Badge tone={quotaTone(s.quotaState)}>{s.quotaState}</Badge>
              </td>
              <td className="nowrap">
                {s.cooldownUntil ? (
                  <span className="muted">{relTime(s.cooldownUntil)}</span>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td>
                <Badge tone={routeTone(s.routeHealth)}>{s.routeHealth}</Badge>
              </td>
            </tr>
          ))}
          {!scopes.length && (
            <tr>
              <td colSpan={7} className="muted">
                No provider scopes.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="note">
        Paid cash, free allowance and RunPod compute are distinct metrics; they are never folded
        together.
      </div>
    </div>
  );
}

function TimingPanel({ metrics }: { metrics: RunMetrics | null }) {
  if (!metrics || !metrics.timing.length) return null;
  return (
    <div className="panel">
      <h2>Indexing &amp; response timing</h2>
      <table>
        <thead>
          <tr>
            <th>Variant</th>
            <th>Stage</th>
            <th className="num">p50</th>
            <th className="num">p95</th>
            <th className="num">Samples</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {metrics.timing.map((t, i) => (
            <tr key={i}>
              <td className="mono">{t.variantId}</td>
              <td>{t.stage}</td>
              <td className="num">
                {t.p50Ms === null ? <span className="na">n/a</span> : fmtDuration(t.p50Ms)}
              </td>
              <td className="num">
                {t.p95Ms === null ? <span className="na">n/a</span> : fmtDuration(t.p95Ms)}
              </td>
              <td className="num">{t.sampleCount}</td>
              <td className="muted">
                {t.nullReason ?? (t.sampleCount < 5 ? 'low sample — unstable' : '')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="note">
        Native services may have no index stage — shown as n/a with reason, never 0. Queue wait is
        reported separately from provider response time.
      </div>
    </div>
  );
}

function IssuesPanel({ snap, tasks }: { snap: RunSnapshot; tasks: TaskObject[] }) {
  const issues = [
    ...snap.blockers.map((b) => ({ ...b, where: 'run blocker' })),
    ...tasks.filter((t) => t.issue).map((t) => ({ ...t.issue!, where: t.taskId })),
  ];
  return (
    <div className="panel">
      <h2>Issues (sanitized)</h2>
      {issues.length === 0 ? (
        <p className="muted">No active issues.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Where</th>
              <th>Message</th>
              <th>Retryable</th>
              <th>Next eligible</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((it, i) => (
              <tr key={i}>
                <td>
                  <span className="tag issue">{it.code}</span>
                </td>
                <td className="mono muted">
                  {it.where}
                  {it.scopeId ? ` · ${it.scopeId}` : ''}
                </td>
                <td>{it.message}</td>
                <td>{it.retryable ? 'yes' : 'no'}</td>
                <td className="nowrap muted">
                  {it.nextEligibleAt ? `${fmtTime(it.nextEligibleAt)}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="note">
        Messages are sanitized by the controller — no raw provider payloads, secret URLs or keys.
      </div>
    </div>
  );
}

function EventsPanel({ events }: { events: ControllerEvent[] }) {
  return (
    <div className="panel">
      <h2>
        Recent events{' '}
        <span className="muted" style={{ textTransform: 'none', letterSpacing: 0 }}>
          (deduped, ordered by cursor)
        </span>
      </h2>
      {events.length === 0 ? (
        <p className="muted">No events yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Type</th>
              <th>Rev</th>
              <th>Data</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td className="num mono">{e.id}</td>
                <td>
                  <span className="tag">{e.type}</span>
                </td>
                <td className="mono">{e.revision}</td>
                <td className="mono muted" style={{ fontSize: 11 }}>
                  {JSON.stringify(e.data)}
                </td>
                <td className="nowrap muted">{relTime(e.occurredAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function ProgressBar({
  state,
  stage,
  percent,
}: {
  state: string;
  stage: string | null;
  percent: number | null;
}) {
  const active = ['running', 'submitted', 'leased', 'ready'].includes(state);
  if (percent === null) {
    return (
      <div className="nowrap">
        <div className={`bar ${active ? 'indeterminate' : ''}`}>
          <span style={active ? undefined : { width: state === 'completed' ? '100%' : '0%' }} />
        </div>
        <div className="muted" style={{ fontSize: 11 }}>
          {stage ?? (active ? 'indeterminate' : '—')}
        </div>
      </div>
    );
  }
  return (
    <div className="nowrap">
      <div className="bar">
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="muted" style={{ fontSize: 11 }}>
        {fmtPercent(percent)}
        {stage ? ` · ${stage}` : ''}
      </div>
    </div>
  );
}

function IssueInline({ code, msg }: { code: string; msg: string }) {
  return (
    <span className="issue" title={msg}>
      <span className="tag issue">{code}</span>
    </span>
  );
}

function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function Cell({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="cell">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>('auto');
  useEffect(() => {
    try {
      const saved = localStorage.getItem('vbd-theme') as 'auto' | 'light' | 'dark' | null;
      if (saved) {
        setTheme(saved);
        apply(saved);
      }
    } catch {
      /* ignore */
    }
  }, []);
  const apply = (t: 'auto' | 'light' | 'dark') => {
    const root = document.documentElement;
    if (t === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', t);
  };
  const cycle = () => {
    const next = theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto';
    setTheme(next);
    apply(next);
    try {
      localStorage.setItem('vbd-theme', next);
    } catch {
      /* ignore */
    }
  };
  return (
    <button className="toggle" onClick={cycle} title="Toggle theme">
      theme: {theme}
    </button>
  );
}

// ---------------------------------------------------------------------------
function taskTone(state: string): string {
  if (state === 'completed') return 'done';
  if (['running', 'submitted', 'leased', 'ready'].includes(state)) return 'go';
  if (['waiting_quota', 'pending'].includes(state)) return 'wait';
  if (['blocked'].includes(state)) return 'warn';
  if (['failed', 'cancelled'].includes(state)) return 'bad';
  return 'idle';
}
function quotaTone(q: string): string {
  return q === 'ok' ? 'go' : q === 'waiting_quota' ? 'wait' : q === 'exhausted' ? 'bad' : 'idle';
}
function routeTone(r: string): string {
  return r === 'healthy' ? 'go' : r === 'degraded' ? 'wait' : r === 'down' ? 'bad' : 'idle';
}
function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function describe(e: unknown): string {
  const err = e as { message?: string; code?: string; status?: number };
  return err?.message ? `${err.message}${err.code ? ` [${err.code}]` : ''}` : String(e);
}
