import pg from 'pg'

const { Pool } = pg

const connectionString = process.env.DATABASE_URL

export const pool = new Pool({
  connectionString,
  ssl: connectionString?.includes('herokuapp.com') || process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
})

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY,
      phone_number TEXT,
      status TEXT NOT NULL DEFAULT 'disconnected',
      paired_jid TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY,
      session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      target_jid TEXT NOT NULL,
      payload TEXT NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status TEXT NOT NULL
    );
  `)
}
