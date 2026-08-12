/**
 * Seed the local Hub database with the built-in Larkup tools.
 *
 * Run after `docker compose -f docker/hub-db.yml up` and `pnpm --filter
 * @larkup/hub-db push`: `pnpm --filter @larkup/hub-db seed`. Safe to run
 * more than once — publishing the same id+version is a no-op (see
 * `VersionExistsError` in `repo.ts`).
 */

import 'dotenv/config';
import { BUILTIN_TOOLS } from './builtin-tools';
import { getHubDb } from './client';
import { publishExtension, VersionExistsError } from './repo';

async function main() {
  const db = getHubDb();
  for (const manifest of BUILTIN_TOOLS) {
    try {
      await publishExtension(db, {
        manifest,
        publisherId: 'larkup',
        publisherName: 'Larkup',
      });
      console.log(`seeded ${manifest.id}@${manifest.version}`);
    } catch (err) {
      if (err instanceof VersionExistsError) {
        console.log(`already seeded: ${manifest.id}@${manifest.version}`);
        continue;
      }
      throw err;
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
