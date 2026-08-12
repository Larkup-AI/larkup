import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';

export type HubDb = PostgresJsDatabase<typeof schema>;

let cached: HubDb | undefined;

/**
 * Connection factory, not a module-level singleton connection.
 *
 * `apps/hub` runs as a Vercel Node.js serverless function (see
 * `apps/hub/vercel.json` / `api/index.ts` — no edge runtime declared), so a
 * plain TCP Postgres connection works both there and against a local Docker
 * container. Lazily creates and caches one `postgres()` client per process;
 * a serverless platform reuses a warm process across invocations, so this
 * still avoids reconnecting on every request without pretending the
 * connection outlives the process.
 */
export function getHubDb(connectionString = process.env.DATABASE_URL): HubDb {
  if (cached) return cached;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Local development: docker compose -f docker/hub-db.yml up, ' +
        'then copy apps/hub/.env.example to apps/hub/.env.',
    );
  }
  const client = postgres(connectionString, { max: 5 });
  cached = drizzle(client, { schema });
  return cached;
}

/** Test/script seam: force a fresh connection on the next `getHubDb()` call. */
export function resetHubDbCache(): void {
  cached = undefined;
}
