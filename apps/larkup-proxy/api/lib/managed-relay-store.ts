import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import postgres, { type Sql } from 'postgres';

type RelayRow = { installation_id: string; tunnel_url: string | null; relay_secret_hash: string };
type RelayStoreConfig = { tableName: string; installationColumn: string };
export type ManagedRelayRoute = { installationId: string; tunnelUrl: string };

let client: Sql | undefined;
const schemas = new Map<string, Promise<void>>();

function db(): Sql {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL must be configured for managed channel relay.');
  if (!client) client = postgres(databaseUrl, { max: 1, prepare: false, idle_timeout: 20 });
  return client;
}

function sqlIdentifier(value: string): string {
  if (!/^[a-z_]+$/.test(value)) throw new Error('Invalid managed relay schema identifier.');
  return value;
}

function relayHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashesMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createManagedRelayStore(config: RelayStoreConfig) {
  const table = sqlIdentifier(config.tableName);
  const column = sqlIdentifier(config.installationColumn);

  async function ensureSchema(): Promise<void> {
    let ready = schemas.get(table);
    if (!ready) {
      ready = db()
        .unsafe(
          `CREATE TABLE IF NOT EXISTS ${table} (
            ${column} TEXT PRIMARY KEY,
            tunnel_url TEXT,
            relay_secret_hash TEXT NOT NULL,
            active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )`,
        )
        .then(() => undefined)
        .catch((error: unknown) => {
          schemas.delete(table);
          throw error;
        });
      schemas.set(table, ready);
    }
    await ready;
  }

  async function validSecret(installationId: string, relaySecret: string): Promise<boolean> {
    const rows = (await db().unsafe(`SELECT relay_secret_hash FROM ${table} WHERE ${column} = $1`, [
      installationId,
    ])) as RelayRow[];
    const route = rows[0];
    return Boolean(route && hashesMatch(route.relay_secret_hash, relayHash(relaySecret)));
  }

  return {
    ensureSchema,

    async createInstallation(installationId: string): Promise<string> {
      const relaySecret = randomBytes(32).toString('base64url');
      await ensureSchema();
      await db().unsafe(
        `INSERT INTO ${table} (${column}, relay_secret_hash, tunnel_url, active)
         VALUES ($1, $2, NULL, TRUE)
         ON CONFLICT (${column}) DO UPDATE SET
           relay_secret_hash = EXCLUDED.relay_secret_hash,
           tunnel_url = NULL,
           active = TRUE,
           updated_at = NOW()`,
        [installationId, relayHash(relaySecret)],
      );
      return relaySecret;
    },

    async activate(
      installationId: string,
      relaySecret: string,
      tunnelUrl: string,
    ): Promise<boolean> {
      await ensureSchema();
      if (!(await validSecret(installationId, relaySecret))) return false;
      await db().unsafe(
        `UPDATE ${table}
         SET tunnel_url = $1, active = TRUE, updated_at = NOW()
         WHERE ${column} = $2`,
        [tunnelUrl, installationId],
      );
      return true;
    },

    async deactivate(installationId: string, relaySecret: string): Promise<boolean> {
      await ensureSchema();
      if (!(await validSecret(installationId, relaySecret))) return false;
      await db().unsafe(
        `UPDATE ${table}
         SET active = FALSE, tunnel_url = NULL, updated_at = NOW()
         WHERE ${column} = $1`,
        [installationId],
      );
      return true;
    },

    async find(installationId: string): Promise<ManagedRelayRoute | undefined> {
      await ensureSchema();
      const rows = (await db().unsafe(
        `SELECT ${column} AS installation_id, tunnel_url, relay_secret_hash
         FROM ${table}
         WHERE ${column} = $1 AND active = TRUE AND tunnel_url IS NOT NULL`,
        [installationId],
      )) as RelayRow[];
      const route = rows[0];
      return route?.tunnel_url
        ? { installationId: route.installation_id, tunnelUrl: route.tunnel_url }
        : undefined;
    },
  };
}
