# Database setup

The database runs as the `hundler-postgres` container on our VPS (see
`docker-compose.selfhosted.yml`). On a fresh `pgdata` volume the schema is
applied automatically (`db/schema.sql` then `db/2026-06-27-remnawave-bridge.sql`).
This README covers env vars + applying the schema/migrations manually.

## 1) Environment variables

Set in the server's `.env` (or `.env.local` for local dev):

- `POSTGRESQL_HOST` (`postgres` inside the compose stack)
- `POSTGRESQL_PORT` (`5432`)
- `POSTGRESQL_USER`
- `POSTGRESQL_PASSWORD`
- `POSTGRESQL_DBNAME`
- `POSTGRESQL_SSL_MODE` (`disable` for the internal Docker network / private IP,
  `require` only for an external DB over the internet)
- `POSTGRESQL_SSL_CA_PATH` (optional, only for SSL `require` mode)

## 2) Schema

Schema file: `db/schema.sql`. Tables:

- `users`, `plans`, `servers`, `subscriptions`, `vpn_keys`, `payments`, `logs`
  (plus indexes and `updated_at` triggers)

Remnawave bridge columns live in `db/2026-06-27-remnawave-bridge.sql`.

## 3) Apply schema / migrations manually

The DB is only reachable inside the Docker network, so run `psql` from inside
the container (or `docker exec`) rather than from your laptop:

```bash
# open a shell
docker exec -it hundler-postgres psql -U "$POSTGRESQL_USER" -d "$POSTGRESQL_DBNAME"

# apply a file (e.g. a migration) by piping it in
docker exec -i hundler-postgres psql -U "$POSTGRESQL_USER" -d "$POSTGRESQL_DBNAME" \
  < db/migrations/<file>.sql
```

For local dev against a Postgres reachable from your host you can still use a
normal `psql -h <host> -p 5432 -U <user> -d <db> -f db/schema.sql`.
