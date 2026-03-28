const { Client } = require('pg');

const client = new Client({
  host: '5.42.118.215',
  port: 5432,
  user: 'gen_user',
  password: 'sE*Hn5,Ar=9bc6',
  database: 'default_db',
  ssl: false,
});

async function migrate() {
  try {
    await client.connect();
    console.log('Connected to database');

    // Add ban_type column
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_type TEXT;');
    console.log('Added ban_type column');

    // Create broadcasts table
    await client.query(`
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
    `);
    console.log('Created broadcasts table');

    // Create index
    await client.query('CREATE INDEX IF NOT EXISTS idx_broadcasts_status ON broadcasts(status, created_at DESC);');
    console.log('Created index');

    console.log('Migration completed successfully!');
  } catch (err) {
    console.error('Migration error:', err.message);
  } finally {
    await client.end();
  }
}

migrate();
