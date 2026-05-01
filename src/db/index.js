import pg from 'pg'

const { Pool } = pg

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres'

export const pool = new Pool({
  connectionString,
  ssl: connectionString?.includes('herokuapp.com') || process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
})

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wa_accounts (
      id UUID PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      wa_jid TEXT,
      display_name TEXT,
      session_key TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY,
      account_id UUID REFERENCES wa_accounts(id) ON DELETE SET NULL,
      session_key TEXT NOT NULL,
      target_jid TEXT NOT NULL,
      payload TEXT NOT NULL,
      media_type TEXT NOT NULL DEFAULT 'text',
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status TEXT NOT NULL
    );
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS command_rules (
      id UUID PRIMARY KEY,
      session_key TEXT NOT NULL,
      command TEXT NOT NULL,
      response_type TEXT NOT NULL DEFAULT 'text',
      response_payload TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(session_key, command)
    );
  `)
}
