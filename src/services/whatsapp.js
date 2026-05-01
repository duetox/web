import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } from '@whiskeysockets/baileys'
import P from 'pino'
import { Boom } from '@hapi/boom'
import QRCode from 'qrcode'
import fs from 'fs'
import path from 'path'
import { normalizeJid } from '../utils/jid.js'
import { saveMessageLog, updateAccountConnection } from './store.js'

const sessions = new Map()

function sanitizePhoneNumber(phoneNumber) { return String(phoneNumber || '').replace(/\D/g, '') }
function getSessionDir(sessionKey) { const dir = path.join(process.cwd(), 'sessions', sessionKey); fs.mkdirSync(dir, { recursive: true }); return dir }

export async function createOrGetSession(sessionKey, io) {
  if (sessions.has(sessionKey)) return sessions.get(sessionKey)
  const { state, saveCreds } = await useMultiFileAuthState(getSessionDir(sessionKey))
  const { version } = await fetchLatestBaileysVersion()
  const sock = makeWASocket({ version, logger: P({ level: 'silent' }), auth: state, printQRInTerminal: false, browser: ['WA Clone', 'Chrome', '1.0.0'] })
  const session = { key: sessionKey, sock, status: 'connecting', qr: null, user: null }
  sessions.set(sessionKey, session)
  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages || []) {
      const txt = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '[media]'
      await saveMessageLog({ sessionKey, targetJid: msg.key.remoteJid || 'unknown', payload: txt, status: 'received' })
      io.emit('chat:event', { sessionKey, jid: msg.key.remoteJid, payload: txt, ts: msg.messageTimestamp })
    }
  })

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) { session.qr = await QRCode.toDataURL(qr); io.emit('wa:update', { sessionKey, status: 'qr', qr: session.qr }) }
    if (connection === 'open') {
      session.status = 'connected'; session.user = sock.user
      await updateAccountConnection(sessionKey, { waJid: sock.user?.id || null, displayName: sock.user?.name || null })
      io.emit('wa:update', { sessionKey, status: 'connected', user: sock.user })
    }
    if (connection === 'close') {
      const shouldReconnect = (new Boom(lastDisconnect?.error))?.output?.statusCode !== DisconnectReason.loggedOut
      sessions.delete(sessionKey); io.emit('wa:update', { sessionKey, status: 'disconnected' })
      if (shouldReconnect) await createOrGetSession(sessionKey, io)
    }
  })
  return session
}

export async function pairWithCode(sessionKey, phoneNumber, io) {
  const session = await createOrGetSession(sessionKey, io)
  const code = await session.sock.requestPairingCode(sanitizePhoneNumber(phoneNumber))
  io.emit('wa:update', { sessionKey, status: 'pair-code', pairCode: code })
  return code
}

export async function sendPayload({ sessionKey, jid, payload }) {
  const session = sessions.get(sessionKey)
  if (!session) throw new Error('Session unavailable')
  const targetJid = normalizeJid(jid)
  if (!targetJid) throw new Error('Invalid target')

  let content
  if (payload.type === 'text') content = { text: payload.text }
  else if (payload.type === 'reaction') content = { react: { text: payload.emoji || '👍', key: payload.key } }
  else throw new Error('Unsupported payload type in this starter: text/reaction')

  await session.sock.sendMessage(targetJid, content)
  await saveMessageLog({ sessionKey, targetJid, payload: JSON.stringify(payload), mediaType: payload.type, status: 'sent' })
  return { targetJid }
}
