import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readConfig } from "@larkup/core/config-store";

/**
 * Manages a LOCAL, self-hosted Firecrawl instance via Docker.
 *
 * Self-hosted Firecrawl runs with DB auth disabled, so no real API key is
 * required — any bearer token is accepted. We still generate one automatically
 * ("get its key automatically") and wire both the endpoint and token into the
 * toolkit so web scraping works against localhost without the user touching
 * env vars.
 *
 * State lives in `.larkup/firecrawl-local.json`. The scraper client reads
 * it to decide whether to talk to the local instance or the Firecrawl cloud.
 */

const execAsync = promisify(exec);

async function runCmd(cmd: string, timeout?: number) {
  const env = {
    ...process.env,
    PATH: `${process.env.PATH || ""}:/usr/local/bin:/opt/homebrew/bin:/bin:/usr/bin`,
  };
  return execAsync(cmd, { timeout, env });
}

const DATA_DIR = path.join(process.cwd(), ".larkup");
const STATE_PATH = path.join(DATA_DIR, "firecrawl-local.json");
const COMPOSE_PATH = path.join(DATA_DIR, "firecrawl", "docker-compose.yml");

const CONTAINER_PREFIX = "ragtoolkit-firecrawl";
const DEFAULT_PORT = 3002;
const IMAGE = "ghcr.io/firecrawl/firecrawl:latest";

async function getProxy(): Promise<{ server: string; username?: string; password?: string } | null> {
  // Option 1 (Most Efficient): Try reading from proxies.txt for direct connections
  // By picking a direct IP ourselves, we bypass the rotating proxy load balancer 
  // which slightly improves latency and avoids session stickiness.
  try {
    const proxiesPath = path.join(process.cwd(), "proxies.txt");
    const raw = await fs.readFile(proxiesPath, "utf8");
    const lines = raw.split("\n").map(l => l.trim()).filter(l => l.length > 0);

    if (lines.length > 0) {
      const randomLine = lines[Math.floor(Math.random() * lines.length)];
      const parts = randomLine.split(":");
      
      if (parts.length >= 4) {
        return {
          server: `http://${parts[0]}:${parts[1]}`,
          username: parts[2],
          password: parts[3]
        };
      }
    }
  } catch (err) {
    // If proxies.txt isn't found, silently fall through to the env variables fallback
  }

  // Option 2 (Convenient Fallback): Use the proxy endpoint from configuration
  const config = await readConfig();
  if (config.scraperProxyServer) {
    return {
      server: config.scraperProxyServer,
      username: config.scraperProxyUsername,
      password: config.scraperProxyPassword
    };
  }

  return null;
}

export interface LocalFirecrawlState {
  running: boolean;
  endpoint: string;
  apiKey: string;
  port: number;
  /** docker compose project name */
  project: string;
  startedAt?: string;
  lastError?: string;
}

const EMPTY: LocalFirecrawlState = {
  running: false,
  endpoint: `http://localhost:${DEFAULT_PORT}`,
  apiKey: "",
  port: DEFAULT_PORT,
  project: CONTAINER_PREFIX,
};

/* ----------------------------- state io ----------------------------- */

export async function readLocalState(): Promise<LocalFirecrawlState> {
  try {
    const raw = await fs.readFile(STATE_PATH, "utf8");
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<LocalFirecrawlState>) };
  } catch {
    return EMPTY;
  }
}

async function writeState(state: LocalFirecrawlState) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
  return state;
}

/* --------------------------- docker helpers ------------------------- */

/** Resolve `docker compose` (v2) vs legacy `docker-compose`, or null if absent. */
async function resolveDocker(): Promise<{
  docker: boolean;
  compose: string | null;
}> {
  try {
    await runCmd("docker --version");
  } catch {
    return { docker: false, compose: null };
  }
  try {
    await runCmd("docker compose version");
    return { docker: true, compose: "docker compose" };
  } catch {
    // fall through
  }
  try {
    await runCmd("docker-compose version");
    return { docker: true, compose: "docker-compose" };
  } catch {
    return { docker: true, compose: null };
  }
}

export interface DockerAvailability {
  docker: boolean;
  compose: boolean;
  message: string;
}

export async function checkDocker(): Promise<DockerAvailability> {
  const { docker, compose } = await resolveDocker();
  if (!docker) {
    return {
      docker: false,
      compose: false,
      message:
        "Docker isn't available on this machine. Install Docker Desktop (or the Docker engine) and make sure it's running.",
    };
  }
  if (!compose) {
    return {
      docker: true,
      compose: false,
      message:
        "Docker is installed but the Compose plugin was not found. Install `docker compose` to launch Firecrawl locally.",
    };
  }
  return { docker: true, compose: true, message: "Docker is ready." };
}

/**
 * Compose topology for a minimal self-hosted Firecrawl:
 * redis + the API + the headless Playwright scraping service.
 */
function composeFile(apiKey: string, port: number, proxy: { server: string, username?: string, password?: string } | null) {
  const proxyEnvLines = proxy ? [
    `PROXY_SERVER: "${proxy.server}"`,
    ...(proxy.username && proxy.password ? [
      `PROXY_USERNAME: "${proxy.username}"`,
      `PROXY_PASSWORD: "${proxy.password}"`
    ] : [])
  ] : [];

  const pwEnv = ["PORT: \"3000\"", ...proxyEnvLines].map(l => `      ${l}`).join("\n");
  const apiEnv = [
    `PORT: "3002"`,
    ...proxyEnvLines,
    `HOST: "0.0.0.0"`,
    `REDIS_URL: "redis://redis:6379"`,
    `REDIS_RATE_LIMIT_URL: "redis://redis:6379"`,
    `PLAYWRIGHT_MICROSERVICE_URL: "http://playwright-service:3000/scrape"`,
    `USE_DB_AUTHENTICATION: "false"`,
    `TEST_API_KEY: "${apiKey}"`,
    `BULL_AUTH_KEY: "${apiKey}"`,
    `DATABASE_URL: "postgresql://user:password@db:5432/postgres"`,
    `NUQ_DATABASE_URL: "postgresql://user:password@db:5432/postgres"`,
    `NUQ_RABBITMQ_URL: "amqp://user:password@rabbitmq:5672"`
  ].map(l => `      ${l}`).join("\n");

  return `# Auto-generated by RAG Toolkit. Do not edit by hand.
services:
  db:
    image: ghcr.io/firecrawl/nuq-postgres:latest
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
      POSTGRES_DB: postgres
    restart: unless-stopped

  rabbitmq:
    image: rabbitmq:3-management-alpine
    environment:
      RABBITMQ_DEFAULT_USER: user
      RABBITMQ_DEFAULT_PASS: password
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "check_running"]
      interval: 5s
      timeout: 5s
      retries: 3
      start_period: 5s
    restart: unless-stopped

  redis:
    image: redis:alpine
    command: redis-server --save "" --appendonly no
    restart: unless-stopped

  playwright-service:
    image: ghcr.io/firecrawl/playwright-service:latest
    environment:
${pwEnv}
    restart: unless-stopped

  api:
    image: ${IMAGE}
    depends_on:
      - db
      - rabbitmq
      - redis
      - playwright-service
    ports:
      - "${port}:3002"
    environment:
${apiEnv}
    restart: unless-stopped
`;
}

/* ------------------------------ actions ----------------------------- */

/** Launch (or re-attach to) a local Firecrawl via docker compose. */
export async function startLocal(): Promise<LocalFirecrawlState> {
  const avail = await checkDocker();
  if (!avail.compose) {
    return writeState({
      ...(await readLocalState()),
      running: false,
      lastError: avail.message,
    });
  }

  const { compose } = await resolveDocker();
  const prev = await readLocalState();
  // Reuse an existing token if we have one, otherwise generate a fresh key.
  const apiKey = prev.apiKey || `fc-local-${randomUUID()}`;
  const port = prev.port || DEFAULT_PORT;

  const proxy = await getProxy();

  await fs.mkdir(path.dirname(COMPOSE_PATH), { recursive: true });
  await fs.writeFile(COMPOSE_PATH, composeFile(apiKey, port, proxy), "utf8");

  try {
    await runCmd(
      `${compose} -p ${CONTAINER_PREFIX} -f "${COMPOSE_PATH}" up -d`,
      180_000
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "docker compose failed";
    return writeState({
      ...prev,
      apiKey,
      port,
      running: false,
      lastError: message,
    });
  }

  const isDockerContainer = existsSync("/.dockerenv");
  const host = isDockerContainer ? "host.docker.internal" : "localhost";
  const endpoint = `http://${host}:${port}`;
  const healthy = await waitForHealth(endpoint, 60_000);

  return writeState({
    running: healthy,
    endpoint,
    apiKey,
    port,
    project: CONTAINER_PREFIX,
    startedAt: new Date().toISOString(),
    lastError: healthy
      ? undefined
      : "Containers started but the API did not become healthy in time. It may still be warming up — try refreshing in a moment.",
  });
}

/** Stop and remove the local Firecrawl containers. */
export async function stopLocal(): Promise<LocalFirecrawlState> {
  const { compose } = await resolveDocker();
  const prev = await readLocalState();
  if (compose) {
    try {
      await runCmd(
        `${compose} -p ${CONTAINER_PREFIX} -f "${COMPOSE_PATH}" down`,
        60_000
      );
    } catch {
      // best-effort
    }
  }
  return writeState({ ...prev, running: false, startedAt: undefined });
}

/** Re-check whether the local instance is actually responding. */
export async function refreshLocalStatus(): Promise<LocalFirecrawlState> {
  const state = await readLocalState();
  if (!state.startedAt) return state;
  const healthy = await isHealthy(state.endpoint);
  if (healthy !== state.running) {
    return writeState({ ...state, running: healthy });
  }
  return state;
}

/* ------------------------------ health ------------------------------ */

async function isHealthy(endpoint: string): Promise<boolean> {
  try {
    const res = await fetch(endpoint, {
      method: "GET",
      signal: AbortSignal.timeout(4000),
    });
    // Self-hosted Firecrawl root returns a friendly 200; any response means it's up.
    return res.status > 0;
  } catch {
    return false;
  }
}

async function waitForHealth(endpoint: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHealthy(endpoint)) return true;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}
