import { v4 as uuidv4 } from 'uuid'
import { pool } from '../db/index.js'

export async function upsertSession({ id, phoneNumber = null, status = 'disconnected', pairedJid = null }) {
  const sessionId = id || uuidv4()
  await pool.query(
    `INSERT INTO sessions (id, phone_number, status, paired_jid, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (id) DO UPDATE
     SET phone_number = EXCLUDED.phone_number,
         status = EXCLUDED.status,
         paired_jid = EXCLUDED.paired_jid,
         updated_at = NOW()`,
    [sessionId, phoneNumber, status, pairedJid]
  )
  return sessionId
}

export async function saveMessageLog({ sessionId, targetJid, payload, status }) {
  await pool.query(
    `INSERT INTO messages (id, session_id, target_jid, payload, status)
     VALUES ($1, $2, $3, $4, $5)`,
    [uuidv4(), sessionId, targetJid, payload, status]
  )
}

export async function listRecentMessages(limit = 30) {
  const { rows } = await pool.query(
    `SELECT m.id, m.session_id, m.target_jid, m.payload, m.status, m.sent_at
     FROM messages m
     ORDER BY m.sent_at DESC
     LIMIT $1`,
    [limit]
  )
  return rows
}
