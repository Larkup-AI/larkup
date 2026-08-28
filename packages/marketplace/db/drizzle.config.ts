import { defineConfig } from 'drizzle-kit';
import 'dotenv/config';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy packages/marketplace/.env.example to packages/marketplace/.env ' +
      'after starting docker compose -f docker/marketplace-db.yml up, or export it before running drizzle-kit.',
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './db/drizzle',
  dbCredentials: { url: connectionString },
  strict: true,
  verbose: true,
});
