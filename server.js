import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto'
import { initDb } from './src/db/index.js'
import { createOrGetSession, pairWithCode, registerPendingCredential, sendPayload } from './src/services/whatsapp.js'
import { createAccount, getAccountByUsername, listAccounts, listCommandRules, listRecentMessages, upsertCommandRule } from './src/services/store.js'

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer)
const tokens = new Map()

app.use(express.json({ limit: '5mb' }))
app.use(express.static('public'))

const hashPassword = (pwd, salt = randomBytes(16).toString('hex')) => `${salt}:${scryptSync(pwd, salt, 64).toString('hex')}`
const verifyPassword = (pwd, hashed) => {
  const [salt, key] = hashed.split(':')
  const given = scryptSync(pwd, salt, 64)
  const saved = Buffer.from(key, 'hex')
  return timingSafeEqual(given, saved)
}
const generateUsername = () => `wa_user_${Math.floor(100000 + Math.random() * 900000)}`
const generatePassword = () => randomBytes(10).toString('base64url') + 'A9!'

app.post('/api/auth/first-time', async (_, res) => {
  let username = generateUsername()
  while (await getAccountByUsername(username)) username = generateUsername()
  const password = generatePassword()
  const sessionKey = randomUUID()
  await createAccount({ username, passwordHash: hashPassword(password), sessionKey })
  registerPendingCredential(sessionKey, { username, password })
  await createOrGetSession(sessionKey, io)
  res.json({ ok: true, username, sessionKey, notice: 'Credentials will be sent to your connected WhatsApp once linked.' })
})

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body
  const acct = await getAccountByUsername(username)
  if (!acct || !verifyPassword(password, acct.password_hash)) return res.status(401).json({ ok: false, error: 'Invalid credentials' })
  const token = randomUUID(); tokens.set(token, acct.session_key)
  await createOrGetSession(acct.session_key, io)
  res.json({ ok: true, token, sessionKey: acct.session_key, profile: { username: acct.username, waJid: acct.wa_jid, name: acct.display_name } })
})

app.post('/api/session/pair-code', async (req, res) => {
  const { sessionKey, phoneNumber } = req.body
  const code = await pairWithCode(sessionKey, phoneNumber, io)
  res.json({ ok: true, code })
})

app.post('/api/message/send', async (req, res) => {
  const { token, jid, payload } = req.body
  const sessionKey = tokens.get(token)
  if (!sessionKey) return res.status(401).json({ ok: false, error: 'Unauthorized' })
  const result = await sendPayload({ sessionKey, jid, payload })
  res.json({ ok: true, result })
})

app.get('/api/bootstrap', async (_, res) => res.json({ ok: true, accounts: await listAccounts() }))
app.get('/api/messages/recent', async (_, res) => res.json({ ok: true, rows: await listRecentMessages() }))
app.post('/api/auth/logout', (req, res) => { tokens.delete(req.body.token); res.json({ ok: true }) })


app.get('/api/commands', async (req, res) => {
  const sessionKey = tokens.get(req.query.token)
  if (!sessionKey) return res.status(401).json({ ok: false, error: 'Unauthorized' })
  res.json({ ok: true, rows: await listCommandRules(sessionKey) })
})

app.post('/api/commands', async (req, res) => {
  const { token, command, responseType, responsePayload } = req.body
  const sessionKey = tokens.get(token)
  if (!sessionKey) return res.status(401).json({ ok: false, error: 'Unauthorized' })
  await upsertCommandRule({ sessionKey, command, responseType, responsePayload: JSON.stringify(responsePayload) })
  res.json({ ok: true })
})


const port = Number(process.env.PORT || 3000)
initDb().then(() => httpServer.listen(port, () => console.log(`Server running on :${port}`)))
