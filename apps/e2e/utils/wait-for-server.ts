/**
 * Poll a URL until it responds with HTTP 200, or throw after timeout.
 */
export async function waitForServer(
  url: string,
  { timeout = 120_000, interval = 2_000, label = "Server" } = {}
): Promise<void> {
  const start = Date.now();
  let lastError = "";

  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (res.ok) {
        console.log(`  ✓ ${label} is ready at ${url}`);
        return;
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, interval));
  }

  throw new Error(
    `${label} at ${url} did not become ready within ${timeout / 1000}s. Last error: ${lastError}`
  );
}

/**
 * Wait for the web UI dev server on port 4567.
 */
export async function waitForWebUI(timeout = 120_000): Promise<void> {
  return waitForServer("http://localhost:4567", {
    timeout,
    label: "Web UI (4567)",
  });
}

/**
 * Wait for the generated RAG server on port 8080.
 */
export async function waitForRAGServer(timeout = 60_000): Promise<void> {
  return waitForServer("http://localhost:8080/health", {
    timeout,
    label: "RAG Server (8080)",
  });
}
