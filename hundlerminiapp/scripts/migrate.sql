-- Add missing ban_type column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_type TEXT;

-- Create broadcasts table
CREATE TABLE IF NOT EXISTS broadcasts (
  id BIGSERIAL PRIMARY KEY,
  title TEXT,
  message TEXT NOT NULL,
  image_url TEXT,
  button_text TEXT,
  button_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  total_users INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_broadcasts_status ON broadcasts(status, created_at DESC);
