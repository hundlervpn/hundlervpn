# Database

> **2026-07:** the database is now a **Postgres container on our own VPS**
> (`159.195.58.174`), started by `docker-compose.selfhosted.yml` as the
> `hundler-postgres` service with a persistent `pgdata` volume. The previous
> Hostman managed PG and the older Timeweb host are both dead — do not connect
> to them.

## Connection

The app builds its connection string from env vars (see `lib/postgres-config.ts`):

- `POSTGRESQL_HOST` — `postgres` (the Docker service name; resolved on the
  internal `web` network). Do NOT use the public IP from inside the compose stack.
- `POSTGRESQL_PORT` — `5432`
- `POSTGRESQL_USER` / `POSTGRESQL_PASSWORD` / `POSTGRESQL_DBNAME`
- `POSTGRESQL_SSL_MODE` — `disable` (internal Docker network, no TLS needed).
  `require` is only for connecting to an external managed DB over the internet.
- `POSTGRESQL_SSL_CA_PATH` — optional, only when `SSL_MODE=require`.

**IMPORTANT:** never paste real DB credentials into this file or any committed
file. They live in the server's `.env` (gitignored) only.

## Schema init

On a **fresh** `pgdata` volume, Postgres auto-runs everything in
`/docker-entrypoint-initdb.d/` alphabetically:

1. `01-schema.sql` → `db/schema.sql` (tables, indexes, `updated_at` triggers)
2. `02-remnawave-bridge.sql` → `db/2026-06-27-remnawave-bridge.sql`
   (Remnawave bridge columns NOT present in `schema.sql`)

These init scripts do **not** run again on an existing volume, so redeploys and
app rebuilds never touch data. See `db/README.md` for applying the schema
manually or running later migrations.
