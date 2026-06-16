-- Stat overrides: owner can override displayed statistics.
-- Single row table — overrides is a JSONB blob.
CREATE TABLE IF NOT EXISTS stat_overrides (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  overrides JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO stat_overrides (id, overrides) VALUES (1, '{}') ON CONFLICT DO NOTHING;
