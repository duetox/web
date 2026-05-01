import { randomUUID } from 'crypto'
import { pool } from '../db/index.js'

export async function createAccount({ username, passwordHash, sessionKey, waJid = null, displayName = null }) {
  const id = randomUUID()
  await pool.query(
    `INSERT INTO wa_accounts (id, username, password_hash, session_key, wa_jid, display_name, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
    [id, username, passwordHash, sessionKey, waJid, displayName]
  )
  return { id, username, sessionKey, waJid, displayName }
}

export async function getAccountByUsername(username) {
  const { rows } = await pool.query('SELECT * FROM wa_accounts WHERE username=$1 LIMIT 1', [username])
  return rows[0] || null
}

export async function getAccountBySessionKey(sessionKey) {
  const { rows } = await pool.query('SELECT * FROM wa_accounts WHERE session_key=$1 LIMIT 1', [sessionKey])
  return rows[0] || null
}

export async function updateAccountConnection(sessionKey, { waJid, displayName }) {
  await pool.query('UPDATE wa_accounts SET wa_jid=$2, display_name=$3, updated_at=NOW() WHERE session_key=$1', [sessionKey, waJid, displayName])
}

export async function listAccounts() {
  const { rows } = await pool.query('SELECT id, username, wa_jid, display_name, created_at FROM wa_accounts ORDER BY created_at DESC')
  return rows
}

export async function saveMessageLog({ accountId = null, sessionKey, targetJid, payload, mediaType = 'text', status }) {
  await pool.query(
    `INSERT INTO messages (id, account_id, session_key, target_jid, payload, media_type, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [randomUUID(), accountId, sessionKey, targetJid, payload, mediaType, status]
  )
}

export async function listRecentMessages(limit = 60) {
  const { rows } = await pool.query(
    `SELECT m.id, m.session_key, m.target_jid, m.payload, m.media_type, m.status, m.sent_at, a.username
     FROM messages m
     LEFT JOIN wa_accounts a ON a.id=m.account_id
     ORDER BY m.sent_at DESC
     LIMIT $1`,
    [limit]
  )
  return rows
}
