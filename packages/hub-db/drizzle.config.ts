import { defineConfig } from 'drizzle-kit';
import 'dotenv/config';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy packages/hub-db/.env.example to packages/hub-db/.env ' +
      'after starting docker compose -f docker/hub-db.yml up, or export it before running drizzle-kit.',
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: connectionString },
  strict: true,
  verbose: true,
});
