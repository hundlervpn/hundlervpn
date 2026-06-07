import { dbQuery } from './db';

/**
 * Lazy migration for the promo soft-delete column. The project's
 * migration story is "manually run scripts/* or POST /api/admin/migrate
 * after deploy" — schema.sql is NOT replayed by Hostman/Timeweb on
 * push. This helper transparently applies the soft-delete migration
 * the first time anything that depends on `promo_codes.deleted_at` is
 * queried.
 *
 * The promise is cached so concurrent requests don't race the ALTER.
 * On failure we reset the cache so the next call retries (cold-start
 * connection flakes shouldn't permanently break promo flows).
 *
 * Idempotent: ALTER TABLE … ADD COLUMN IF NOT EXISTS is a metadata
 * no-op once the column exists, so this is essentially free after the
 * first successful run.
 */
let promoSchemaReady: Promise<void> | null = null;

export function ensurePromoSchema(): Promise<void> {
  if (promoSchemaReady) return promoSchemaReady;
  promoSchemaReady = (async () => {
    try {
      await dbQuery(`
        ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
        CREATE INDEX IF NOT EXISTS idx_promo_codes_deleted_at ON promo_codes(deleted_at);
      `);
    } catch (err) {
      promoSchemaReady = null;
      throw err;
    }
  })();
  return promoSchemaReady;
}
