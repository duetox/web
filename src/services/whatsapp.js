import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } from '@whiskeysockets/baileys'
import P from 'pino'
import { Boom } from '@hapi/boom'
import QRCode from 'qrcode'
import fs from 'fs'
import path from 'path'
import { normalizeJid } from '../utils/jid.js'
import { getCommandRule, saveMessageLog, updateAccountConnection } from './store.js'

const sessions = new Map()
const pendingCredentials = new Map()

async function buildMessageDecoration(sock, senderJid) {
  const cleanNumber = String(senderJid || '').replace(/@s\.whatsapp\.net$/, '')
  const tagUser = cleanNumber ? `@${cleanNumber}` : ''
  let thumbnailUrl
  try {
    if (senderJid) thumbnailUrl = await sock.profilePictureUrl(senderJid, 'image')
  } catch {}

  const contextInfo = {
    mentionedJid: senderJid ? [senderJid] : [],
    externalAdReply: {
      title: 'WhatsApp • Status',
      body: tagUser ? `Contact: ${tagUser}` : 'Contact',
      mediaType: 1,
      renderLargerThumbnail: false,
      showAdAttribution: false,
      thumbnailUrl
    }
  }

  return { contextInfo }
}

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

      if (!msg.key.fromMe && txt && txt.startsWith('.')) {
        const rule = await getCommandRule(sessionKey, txt.split(' ')[0])
        if (rule) {
          const targetJid = msg.key.remoteJid
          const payload = JSON.parse(rule.response_payload)
          const decoration = await buildMessageDecoration(sock, msg.key.participant || targetJid)
          if (rule.response_type === 'text') await sock.sendMessage(targetJid, { text: payload.text || '', ...decoration })
          if (rule.response_type === 'image') await sock.sendMessage(targetJid, { image: { url: payload.url }, caption: payload.caption || '', ...decoration })
        }
      }
    }
  })

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) { session.qr = await QRCode.toDataURL(qr); io.emit('wa:update', { sessionKey, status: 'qr', qr: session.qr }) }
    if (connection === 'open') {
      session.status = 'connected'; session.user = sock.user
      await updateAccountConnection(sessionKey, { waJid: sock.user?.id || null, displayName: sock.user?.name || null })
      const creds = pendingCredentials.get(sessionKey)
      if (creds && sock.user?.id) {
        await sock.sendMessage(sock.user.id, {
          text: `Your panel credentials\nUsername: ${creds.username}\nPassword: ${creds.password}`
        })
        pendingCredentials.delete(sessionKey)
      }
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

export function registerPendingCredential(sessionKey, creds) {
  pendingCredentials.set(sessionKey, creds)
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
  const decoration = await buildMessageDecoration(session.sock, targetJid)
  if (payload.type === 'text') content = { text: payload.text, ...decoration }
  else if (payload.type === 'reaction') content = { react: { text: payload.emoji || '👍', key: payload.key } }
  else if (payload.type === 'image') content = { image: { url: payload.url }, caption: payload.caption || '', ...decoration }
  else if (payload.type === 'video') content = { video: { url: payload.url }, caption: payload.caption || '', ...decoration }
  else if (payload.type === 'document') content = { document: { url: payload.url }, fileName: payload.fileName || 'file', ...decoration }
  else throw new Error('Unsupported payload type in this starter: text/reaction/image/video/document')

  await session.sock.sendMessage(targetJid, content)
  await saveMessageLog({ sessionKey, targetJid, payload: JSON.stringify(payload), mediaType: payload.type, status: 'sent' })
  return { targetJid }
}
