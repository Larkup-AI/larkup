import os from 'node:os';

/**
 * Get OS-aware dynamic concurrency limits to prevent CPU/memory overload
 * during heavy media processing tasks (like FFmpeg and LLM API calls).
 */
export function getConcurrencyLimits() {
  const cpus = os.cpus().length;
  const freeMemGB = os.freemem() / (1024 * 1024 * 1024);

  // 1. FFmpeg Thread Limit
  // Leave 1-2 cores free if possible. Never exceed total cores.
  // For weak systems (<= 2 cores), just use 1 thread to be safe.
  const ffmpegThreads = Math.max(1, Math.floor(cpus * 0.5));

  // 2. Can we run parallel FFmpeg tasks?
  // Only if we have 4 or more cores, we can afford parallel video+audio extraction.
  const canParallelizeFfmpeg = cpus >= 4;

  // 3. LLM API / Async I/O Concurrency
  // Mostly memory & network bound, but also impacts Node event loop.
  // Base is 3, up to 10 on high-end systems.
  const apiConcurrency = Math.max(3, Math.min(10, Math.floor(cpus * 1.5)));

  // 4. Batch Insertion Limit (for database inserts)
  // E.g., LanceDB. Can be higher since it's I/O bound.
  const dbBatchSize = Math.max(10, Math.min(50, Math.floor(freeMemGB * 10)));

  return {
    cpus,
    freeMemGB,
    ffmpegThreads,
    canParallelizeFfmpeg,
    apiConcurrency,
    dbBatchSize,
  };
}
