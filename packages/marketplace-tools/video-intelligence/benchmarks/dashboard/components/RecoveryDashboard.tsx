'use client';
import { useEffect, useState, type ReactNode } from 'react';
type Model = {
  reader: string;
  correct: number;
  total: number;
  baselineCorrect: number;
  pending: number;
  failed: {
    questionId: string;
    pending: boolean;
    question: string;
    options: string[];
    predicted: string | null;
    official: string;
    answer: string;
  }[];
};
type Recovery = { status: string; method: string; models: Model[] };
const names: Record<string, string> = {
  latest: 'Gemini',
  qwen: 'Qwen',
  muse: 'Muse',
  minimax: 'MiniMax',
};
export default function RecoveryDashboard({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Recovery | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [history, setHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get('tab') !== 'larkup' || !params.get('run')) {
        setData(null);
        setError(null);
        setLoaded(true);
        return;
      }
      try {
        const response = await fetch(
          '/api/recovery?run=' + encodeURIComponent(params.get('run')!),
          { cache: 'no-store' },
        );
        if (response.ok) {
          const next = await response.json();
          if (!disposed) {
            setData(next);
            setError(null);
          }
        } else if (response.status === 404 && !disposed) {
          setData(null);
          setError(null);
        } else if (!disposed) setError('Current results could not be refreshed.');
      } catch {
        if (!disposed) setError('Current results could not be refreshed.');
      } finally {
        if (!disposed) setLoaded(true);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);
  if (!loaded)
    return (
      <main className="wrap">
        <p>Loading current results…</p>
      </main>
    );
  if (!data && !error) return <>{children}</>;
  if (!data)
    return (
      <main className="wrap">
        <p role="alert">{error}</p>
        <button onClick={() => setHistory(!history)}>Show original controller snapshot</button>
        {history && children}
      </main>
    );
  const common = data.models.reduce<Record<string, number>>((all, m) => {
    for (const q of m.failed) all[q.questionId] = (all[q.questionId] ?? 0) + 1;
    return all;
  }, {});
  return (
    <main className="wrap">
      <header className="top">
        <div>
          <h1>Video Benchmark · Current results</h1>
          <div className="sub">Failed-question recovery · DeepSeek V4 Pro answer backbone</div>
        </div>
        <strong style={{ color: data.status === 'running' ? 'var(--wait)' : 'var(--go)' }}>
          {data.status === 'running' ? 'Retrying failed questions' : 'Recovery completed'}
        </strong>
      </header>
      {error && (
        <div role="alert" className="banner error">
          {error} Showing the last validated results.
        </div>
      )}
      <div className="banner">
        Historical passes are retained. These are cumulative results, not a new full-suite run. The
        original pilot’s paused state is preserved below.
      </div>
      <section className="panel">
        <h2>Current accuracy</h2>
        <table style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Video reader</th>
              <th>Before</th>
              <th>Current</th>
              <th>Recovered</th>
              <th>Pending retry</th>
            </tr>
          </thead>
          <tbody>
            {data.models.map((m) => (
              <tr key={m.reader}>
                <td>{names[m.reader] ?? m.reader}</td>
                <td>
                  {m.baselineCorrect}/{m.total}
                </td>
                <td>
                  <strong>
                    {m.correct}/{m.total}
                  </strong>
                </td>
                <td>+{m.correct - m.baselineCorrect}</td>
                <td>{m.pending || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="panel">
        <h2>Remaining official failures</h2>
        <p className="muted">
          Original reference options are unchanged. Expand a question to inspect the current answer.
        </p>
        {data.models.map((m) => (
          <div key={m.reader} style={{ marginBottom: 20 }}>
            <h3>
              {names[m.reader] ?? m.reader} · {m.failed.length} remaining
            </h3>
            {m.failed.map((q) => (
              <details
                key={q.questionId}
                style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}
              >
                <summary>
                  {q.question}{' '}
                  <span className="muted">
                    {' '}
                    · {common[q.questionId]}/{data.models.length} readers
                  </span>
                </summary>
                {q.pending && (
                  <p>
                    <strong>Pending retry</strong> · Previous answer preserved below.
                  </p>
                )}
                <p>{q.answer || 'No supported option was established.'}</p>
                <p>
                  {q.pending ? 'Previous answer' : 'Answer'}:{' '}
                  <strong>{q.predicted ?? 'Abstained'}</strong> · Official:{' '}
                  <strong>{q.official}</strong>
                </p>
                <ol type="A">
                  {q.options.map((o, i) => (
                    <li key={i}>{o.replace(/^[A-Z]\.\s*/, '')}</li>
                  ))}
                </ol>
                <small className="mono">{q.questionId}</small>
              </details>
            ))}
          </div>
        ))}
      </section>
      <button onClick={() => setHistory(!history)}>
        {history ? 'Hide' : 'Show'} original pilot controller state
      </button>
      {history && children}
    </main>
  );
}
