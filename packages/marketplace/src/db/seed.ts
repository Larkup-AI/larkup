/** Seeds built-in Marketplace tools. */

import 'dotenv/config';
import { BUILTIN_TOOLS } from './builtin-tools.js';
import { getMarketplaceDb } from './client.js';
import { publishExtension, VersionExistsError } from './repo.js';

async function main() {
  const db = getMarketplaceDb();
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
