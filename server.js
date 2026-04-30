import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { v4 as uuidv4 } from 'uuid'
import { initDb } from './src/db/index.js'
import { createOrGetSession, pairWithCode, sendTextToJid } from './src/services/whatsapp.js'
import { listRecentMessages } from './src/services/store.js'

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer)

app.use(express.json({ limit: '2mb' }))
app.use(express.static('public'))

app.get('/health', (_, res) => res.json({ ok: true }))

app.post('/api/session/start', async (req, res) => {
  try {
    const sessionId = req.body.sessionId || uuidv4()
    await createOrGetSession(sessionId, io)
    res.json({ ok: true, sessionId })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

app.post('/api/session/pair-code', async (req, res) => {
  try {
    const { sessionId, phoneNumber } = req.body
    if (!sessionId || !phoneNumber) return res.status(400).json({ ok: false, error: 'sessionId and phoneNumber are required' })
    const code = await pairWithCode(sessionId, phoneNumber, io)
    res.json({ ok: true, code })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

app.post('/api/message/send', async (req, res) => {
  try {
    const { sessionId, jid, target, payload } = req.body
    const recipient = target || jid
    if (!sessionId || !recipient || !payload) return res.status(400).json({ ok: false, error: 'sessionId, target/ jid, payload are required' })
    const result = await sendTextToJid({ sessionId, jid: recipient, payload })
    res.json({ ok: true, result })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

app.get('/api/messages/recent', async (_, res) => {
  const rows = await listRecentMessages(40)
  res.json({ ok: true, rows })
})

const port = Number(process.env.PORT || 3000)

initDb().then(() => {
  httpServer.listen(port, () => {
    console.log(`Server running on :${port}`)
  })
})
