import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } from '@whiskeysockets/baileys'
import P from 'pino'
import { Boom } from '@hapi/boom'
import QRCode from 'qrcode'
import fs from 'fs'
import path from 'path'
import { get } from 'https'
import { normalizeJid } from '../utils/jid.js'
import { getCommandRule, saveMessageLog, updateAccountConnection } from './store.js'

const sessions = new Map()
const pendingCredentials = new Map()

function sanitizePhoneNumber(phoneNumber) { return String(phoneNumber || '').replace(/\D/g, '') }
function getSessionDir(sessionKey) { const dir = path.join(process.cwd(), 'sessions', sessionKey); fs.mkdirSync(dir, { recursive: true }); return dir }

async function fetchBufferFromUrl(url) {
  return new Promise((resolve, reject) => {
    const chunks = []
    get(url, (res) => {
      res.on('data', (d) => chunks.push(d))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    }).on('error', reject)
  })
}

async function buildQuotedContact(sock, senderJid) {
  let thumbnail
  try {
    const pfpUrl = await sock.profilePictureUrl(senderJid, 'image')
    thumbnail = await fetchBufferFromUrl(pfpUrl)
  } catch {
    thumbnail = undefined
  }
  const number = (senderJid || '').split('@')[0]
  return {
    key: { fromMe: false, participant: '0@s.whatsapp.net', remoteJid: 'status@broadcast' },
    message: {
      contactMessage: {
        displayName: `@${number}`,
        vcard: `BEGIN:VCARD\nVERSION:3.0\nN:XL;${number},;;;\nFN:@${number}\nitem1.TEL;waid=${number}:${number}\nitem1.X-ABLabel:Contact\nEND:VCARD`,
        jpegThumbnail: thumbnail
      }
    }
  }
}

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
          const quoted = await buildQuotedContact(sock, msg.key.participant || msg.key.remoteJid)
          if (rule.response_type === 'text') await sock.sendMessage(targetJid, { text: payload.text || '' }, { quoted, mentions: [msg.key.participant || msg.key.remoteJid] })
          if (rule.response_type === 'image') await sock.sendMessage(targetJid, { image: { url: payload.url }, caption: payload.caption || '' }, { quoted, mentions: [msg.key.participant || msg.key.remoteJid] })
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
  if (payload.type === 'text') content = { text: payload.text }
  else if (payload.type === 'reaction') content = { react: { text: payload.emoji || '👍', key: payload.key } }
  else if (payload.type === 'image') content = { image: { url: payload.url }, caption: payload.caption || '' }
  else if (payload.type === 'video') content = { video: { url: payload.url }, caption: payload.caption || '' }
  else if (payload.type === 'document') content = { document: { url: payload.url }, fileName: payload.fileName || 'file' }
  else throw new Error('Unsupported payload type in this starter: text/reaction/image/video/document')

  const mentionJid = session.sock.user?.id || targetJid
  const quoted = await buildQuotedContact(session.sock, mentionJid)
  await session.sock.sendMessage(targetJid, content, { quoted, mentions: [mentionJid] })
  await saveMessageLog({ sessionKey, targetJid, payload: JSON.stringify(payload), mediaType: payload.type, status: 'sent' })
  return { targetJid }
}
