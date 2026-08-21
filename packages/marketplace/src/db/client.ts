import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type MarketplaceDb = PostgresJsDatabase<typeof schema>;

let cached: MarketplaceDb | undefined;

/** Returns the process-local Marketplace database client. */
export function getMarketplaceDb(connectionString = process.env.DATABASE_URL): MarketplaceDb {
  if (cached) return cached;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Start docker/marketplace-db.yml and copy ' +
        'packages/marketplace/.env.example to packages/marketplace/.env.',
    );
  }
  const client = postgres(connectionString, { max: 5 });
  cached = drizzle(client, { schema });
  return cached;
}

/** Clears the cached client for tests and scripts. */
export function resetMarketplaceDbCache(): void {
  cached = undefined;
}
