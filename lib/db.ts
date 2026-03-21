import { Pool, type QueryResultRow } from 'pg';
import { getPostgresRuntimeConfig } from './postgres-config';

let pool: Pool | null = null;

function createPool() {
  const config = getPostgresRuntimeConfig();

  return new Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
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
