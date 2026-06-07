import { Pool, type QueryResultRow } from 'pg';
import { getPostgresRuntimeConfig } from './postgres-config';

let pool: Pool | null = null;

/**
 * Read a positive integer env var with a sensible default.
 */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createPool() {
  const config = getPostgresRuntimeConfig();

  // Pool tuning — controls how the Node app multiplexes work over server
  // connections. The relevant constraints:
  //
  //   • pg's default `max` is 10. With 500+ concurrent users hitting
  //     `/api/users/sync` on app launch the pool saturates quickly →
  //     subsequent requests queue → connection-timeout errors after 30 s.
  //   • Postgres itself has a hard `max_connections` (~100 on most managed
  //     instances, including Timeweb default). Setting a Node pool wider
  //     than the DB allows is worse than useless — you get failed
  //     `acquire` instead of queued ones.
  //   • In production the BEST architecture is PgBouncer in transaction
  //     pool mode between the app and the DB: the app keeps a fat pool
  //     of cheap "client" connections (e.g. 100), pgbouncer multiplexes
  //     them onto a small (~30) pool of real Postgres backends. This
  //     gives you 1000+ concurrent transactions on a 100-conn DB.
  //
  // ENV variables (set on Timeweb panel):
  //   PG_POOL_MAX               default 30
  //   PG_POOL_IDLE_TIMEOUT_MS   default 30000  (close idle conn after 30 s)
  //   PG_POOL_CONNECT_TIMEOUT_MS default 10000 (give up acquiring after 10 s)
  //
  // Tuning guide (when NOT using pgbouncer — a.k.a. "direct to Postgres"):
  //   ≤ 1k MAU            → PG_POOL_MAX=10  (default)
  //   1k-10k MAU          → PG_POOL_MAX=30
  //   10k-50k MAU         → PG_POOL_MAX=50  (and verify Postgres
  //                          max_connections >= 60; ask Timeweb to raise
  //                          if you're sharing the box)
  //   50k+ MAU            → MUST add pgbouncer; keep PG_POOL_MAX=100 in
  //                          the app and tune `default_pool_size=30` on
  //                          pgbouncer.
  return new Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    max: envInt('PG_POOL_MAX', 30),
    idleTimeoutMillis: envInt('PG_POOL_IDLE_TIMEOUT_MS', 30_000),
    connectionTimeoutMillis: envInt('PG_POOL_CONNECT_TIMEOUT_MS', 10_000),
    // Reuse the same connection for `pg`'s prepared-statement cache —
    // shaves 1 round-trip per repeated query.
    keepAlive: true,
    ssl:
      config.sslMode === 'require'
        ? config.sslCa
          ? { rejectUnauthorized: true, ca: config.sslCa }
          : { rejectUnauthorized: false }
        : false,
  });
}

export function getDbPool() {
  if (!pool) {
    pool = createPool();
  }

  return pool;
}

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  queryText: string,
  values?: unknown[]
) {
  const db = getDbPool();
  return db.query<T>(queryText, values);
}
