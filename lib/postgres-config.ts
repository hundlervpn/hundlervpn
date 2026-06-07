import fs from 'node:fs';

export type PostgresSslMode = 'disable' | 'require';

export type PostgresRuntimeConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  sslMode: PostgresSslMode;
  sslCa?: string;
};

export function getPostgresRuntimeConfig(): PostgresRuntimeConfig {
  const host = process.env.POSTGRESQL_HOST ?? '';
  const port = Number(process.env.POSTGRESQL_PORT ?? '5432');
  const user = process.env.POSTGRESQL_USER ?? '';
  const password = process.env.POSTGRESQL_PASSWORD ?? '';
  const database = process.env.POSTGRESQL_DBNAME ?? '';
  const sslMode = (process.env.POSTGRESQL_SSL_MODE ?? 'disable') as PostgresSslMode;
  const sslCaPath = process.env.POSTGRESQL_SSL_CA_PATH;

  if (!host || !user || !database) {
    throw new Error('PostgreSQL env variables are not fully configured');
  }

  const config: PostgresRuntimeConfig = {
    host,
    port,
    user,
    password,
    database,
    sslMode: sslMode === 'require' ? 'require' : 'disable',
  };

  if (config.sslMode === 'require' && sslCaPath && fs.existsSync(sslCaPath)) {
    config.sslCa = fs.readFileSync(sslCaPath, 'utf8');
  }

  return config;
}

export function buildPostgresConnectionString(config = getPostgresRuntimeConfig()): string {
  const credentials = `${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}`;
  const sslQuery = config.sslMode === 'require' ? 'sslmode=require' : 'sslmode=disable';

  return `postgresql://${credentials}@${config.host}:${config.port}/${config.database}?${sslQuery}`;
}
