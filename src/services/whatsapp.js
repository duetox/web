import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys'
import P from 'pino'
import { Boom } from '@hapi/boom'
import QRCode from 'qrcode'
import fs from 'fs'
import path from 'path'
import { normalizeJid } from '../utils/jid.js'
import { saveMessageLog, upsertSession } from './store.js'

const sessions = new Map()

function sanitizePhoneNumber(phoneNumber) {
  return String(phoneNumber || '').replace(/\D/g, '')
}

async function waitForSocketReady(sock, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('Socket not ready for pairing yet. Please retry in a few seconds.'))
    }, timeoutMs)

    const onUpdate = ({ connection, qr }) => {
      if (connection === 'connecting' || !!qr || connection === 'open') {
        cleanup()
        resolve(true)
      }
    }

    const cleanup = () => {
      clearTimeout(timeout)
      sock.ev.off('connection.update', onUpdate)
    }

    sock.ev.on('connection.update', onUpdate)
  })
}

function getSessionDir(sessionId) {
  const dir = path.join(process.cwd(), 'sessions', sessionId)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export async function createOrGetSession(sessionId, io) {
  if (sessions.has(sessionId)) return sessions.get(sessionId)

  const authDir = getSessionDir(sessionId)
  const { state, saveCreds } = await useMultiFileAuthState(authDir)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    logger: P({ level: 'silent' }),
    auth: state,
    printQRInTerminal: false,
    browser: ['AdvancedWA', 'Chrome', '1.0.0']
  })

  const session = { id: sessionId, sock, qr: null, status: 'connecting', pairedJid: null }
  sessions.set(sessionId, session)
  await upsertSession({ id: sessionId, status: 'connecting' })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      session.qr = await QRCode.toDataURL(qr)
      io.emit('wa:update', { sessionId, qr: session.qr, status: 'qr' })
    }

    if (connection === 'open') {
      session.status = 'connected'
      session.pairedJid = sock.user?.id || null
      await upsertSession({ id: sessionId, status: 'connected', pairedJid: session.pairedJid, phoneNumber: sock.user?.id || null })
      io.emit('wa:update', { sessionId, status: 'connected', user: sock.user })

      if (session.pairedJid) {
        await sock.sendMessage(session.pairedJid, { text: 'Successfully CONNECTED 📈' })
      }
    }

    if (connection === 'close') {
      const shouldReconnect = (new Boom(lastDisconnect?.error))?.output?.statusCode !== DisconnectReason.loggedOut
      session.status = 'disconnected'
      await upsertSession({ id: sessionId, status: 'disconnected', pairedJid: session.pairedJid })
      io.emit('wa:update', { sessionId, status: 'disconnected' })
      sessions.delete(sessionId)
      if (shouldReconnect) {
        await createOrGetSession(sessionId, io)
      }
    }
  })

  return session
}

export async function pairWithCode(sessionId, phoneNumber, io) {
  if (!sessionId) throw new Error('Please start a session first before requesting pairing code.')
  const session = await createOrGetSession(sessionId, io)
  const sanitizedPhone = sanitizePhoneNumber(phoneNumber)
  if (!sanitizedPhone) throw new Error('Invalid phone number. Use digits only in E.164 format without + sign.')

  await waitForSocketReady(session.sock)
  const code = await session.sock.requestPairingCode(sanitizedPhone)
  io.emit('wa:update', { sessionId, status: 'pair-code', pairCode: code })
  return code
}

export async function sendTextToJid({ sessionId, jid, payload }) {
  const session = sessions.get(sessionId)
  if (!session) throw new Error('Session not connected yet.')
  const targetJid = normalizeJid(jid)
  if (!targetJid) throw new Error('Invalid JID')

  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)

  try {
    await session.sock.sendMessage(targetJid, { text })
    await saveMessageLog({ sessionId, targetJid, payload: text, status: 'sent' })
    return { ok: true, targetJid }
  } catch (error) {
    await saveMessageLog({ sessionId, targetJid, payload: text, status: `error:${error.message}` })
    throw error
  }
}
