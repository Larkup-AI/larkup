/**
 * Fuses every timestamped retrieval signal into a short ranked list of windows
 * worth looking at.
 *
 * Retrieval produces several independent opinions about *where* an answer
 * lives -- semantic evidence hits, cross-modal clip embeddings, lexical
 * evidence, the indexed chapter/scene hierarchy, and the source's own ending.
 * Each is weak alone and none of them is worth streaming into a model's
 * context in full. Collapsing them into overlapping windows gives both the
 * bounded inspector a range to decode and the model a handful of timestamps to
 * navigate by, at a fixed and very small context cost.
 */

export type FocusSignalKind = 'semantic' | 'clip-embedding' | 'lexical' | 'hierarchy' | 'ending';

export interface FocusSignal {
  kind: FocusSignalKind;
  startSecs: number;
  endSecs: number;
  /** Normalized 0..1 strength within its own signal. */
  score: number;
  label?: string;
}

export interface FocusRange {
  startSecs: number;
  endSecs: number;
  score: number;
  /** Distinct signal kinds that landed in this window, strongest first. */
  sources: FocusSignalKind[];
  label?: string;
}

// Deliberately favours signals that read meaning over signals that match
// characters: a caption or clip vector locates the answer to a question asked
// in other words, whereas a lexical hit mostly confirms wording already known.
const WEIGHTS: Record<FocusSignalKind, number> = {
  semantic: 1,
  'clip-embedding': 0.85,
  lexical: 0.5,
  hierarchy: 0.45,
  ending: 0.35,
};

/** Windows nearer than this describe the same moment and are merged. */
const MERGE_GAP_SECS = 12;

/** A signal wider than this many inspection windows locates nothing. */
const LOCATOR_SPAN_LIMIT = 4;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** Rescales a signal group to 0..1 so no provider's raw scale dominates. */
export function normalizeSignals(signals: FocusSignal[]): FocusSignal[] {
  const byKind = new Map<FocusSignalKind, FocusSignal[]>();
  for (const signal of signals) {
    const group = byKind.get(signal.kind) ?? [];
    group.push(signal);
    byKind.set(signal.kind, group);
  }
  const normalized: FocusSignal[] = [];
  for (const group of byKind.values()) {
    const scores = group.map((signal) => signal.score);
    const highest = Math.max(...scores);
    const lowest = Math.min(...scores);
    const spread = highest - lowest;
    for (const signal of group) {
      normalized.push({
        ...signal,
        score: spread > 1e-6 ? clamp01((signal.score - lowest) / spread) : 1,
      });
    }
  }
  return normalized;
}

/**
 * Collapses signals into ranked windows. Overlap across *different* kinds is
 * what promotes a window: two independent signals agreeing on a moment is far
 * stronger evidence that the answer is there than one signal insisting twice.
 */
export function fuseFocusRanges(
  signals: FocusSignal[],
  options: { maxRanges?: number; minWindowSecs?: number; maxWindowSecs?: number } = {},
): FocusRange[] {
  const minWindowSecs = options.minWindowSecs ?? 20;
  const maxWindowSecs = options.maxWindowSecs ?? 60;
  // A record that spans the whole source -- a summary, an overview, a state
  // that held throughout -- is real evidence but not a *locator*: it overlaps
  // everything, so left in the clustering it swallows every distinct moment
  // into one window and the ranked list collapses to a single useless range.
  const locatorLimitSecs = maxWindowSecs * LOCATOR_SPAN_LIMIT;
  const usable = signals.filter(
    (signal) =>
      Number.isFinite(signal.startSecs) &&
      Number.isFinite(signal.endSecs) &&
      signal.endSecs >= signal.startSecs &&
      signal.endSecs - signal.startSecs <= locatorLimitSecs,
  );
  if (usable.length === 0) return [];

  const ordered = normalizeSignals(usable).sort((a, b) => a.startSecs - b.startSecs);
  const clusters: Array<{ startSecs: number; endSecs: number; signals: FocusSignal[] }> = [];
  for (const signal of ordered) {
    const current = clusters[clusters.length - 1];
    if (current && signal.startSecs - current.endSecs <= MERGE_GAP_SECS) {
      current.endSecs = Math.max(current.endSecs, signal.endSecs);
      current.signals.push(signal);
      continue;
    }
    clusters.push({ startSecs: signal.startSecs, endSecs: signal.endSecs, signals: [signal] });
  }

  return clusters
    .map((cluster) => {
      const best = new Map<FocusSignalKind, FocusSignal>();
      for (const signal of cluster.signals) {
        const existing = best.get(signal.kind);
        if (!existing || signal.score > existing.score) best.set(signal.kind, signal);
      }
      const contributions = [...best.values()]
        .map((signal) => ({ signal, weighted: signal.score * WEIGHTS[signal.kind] }))
        .sort((a, b) => b.weighted - a.weighted);
      // The strongest signal carries the window; agreement from other kinds
      // adds a decreasing bonus rather than a second full vote.
      const score = contributions.reduce(
        (total, contribution, position) =>
          total + contribution.weighted * (position === 0 ? 1 : 0.45 / position),
        0,
      );
      const span = cluster.endSecs - cluster.startSecs;
      let { startSecs, endSecs } = cluster;
      if (span < minWindowSecs) {
        const pad = (minWindowSecs - span) / 2;
        startSecs = Math.max(0, startSecs - pad);
        endSecs = endSecs + pad;
      } else if (span > maxWindowSecs) {
        // Keep the window centred on its strongest signal, not on the middle
        // of an accidental cluster that a weak neighbour stretched open.
        const anchor = contributions[0].signal;
        const centre = (anchor.startSecs + anchor.endSecs) / 2;
        startSecs = Math.max(cluster.startSecs, centre - maxWindowSecs / 2);
        endSecs = Math.min(cluster.endSecs, startSecs + maxWindowSecs);
      }
      return {
        startSecs: Math.max(0, Math.round(startSecs * 10) / 10),
        endSecs: Math.round(endSecs * 10) / 10,
        score: Math.round(score * 1000) / 1000,
        sources: contributions.map((contribution) => contribution.signal.kind),
        label: contributions.find((contribution) => contribution.signal.label)?.signal.label,
      };
    })
    .sort((left, right) => right.score - left.score || left.startSecs - right.startSecs)
    .slice(0, options.maxRanges ?? 5);
}

/** `152.4` -> `2:32`; the compact form used in model-facing timelines. */
export function formatTimecode(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const padded = `${String(minutes).padStart(hours > 0 ? 2 : 1, '0')}:${String(secs).padStart(
    2,
    '0',
  )}`;
  return hours > 0 ? `${hours}:${padded}` : padded;
}
