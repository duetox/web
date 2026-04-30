const socket = io()
const $ = (id) => document.getElementById(id)

const state = { sessionId: '' }

function setConnectedUI(isConnected) {
  $('connectCard').classList.toggle('hidden', isConnected)
  $('chatCard').classList.toggle('hidden', !isConnected)
}

$('startSession').onclick = async () => {
  const sessionId = $('sessionId').value.trim() || undefined
  const res = await fetch('/api/session/start', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ sessionId }) })
  const data = await res.json()
  if (data.ok) {
    state.sessionId = data.sessionId
    $('sessionId').value = data.sessionId
    $('status').textContent = `Session: ${data.sessionId}`
    setConnectedUI(false)
  }
}

$('pairCode').onclick = async () => {
  if (!state.sessionId) {
    $('pair').textContent = 'Pehle session start karo, phir pairing code lo.'
    return
  }
  const phoneNumber = $('phoneNumber').value.trim()
  const res = await fetch('/api/session/pair-code', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ sessionId: state.sessionId, phoneNumber }) })
  const data = await res.json()
  $('pair').textContent = data.ok ? `Pairing code: ${data.code}` : data.error
}

$('send').onclick = async () => {
  const target = $('target').value.trim()
  const payload = $('payload').value
  const res = await fetch('/api/message/send', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ sessionId: state.sessionId, target, payload }) })
  const data = await res.json()
  alert(data.ok ? `Sent to ${data.result.targetJid}` : data.error)
  loadLogs()
}

socket.on('wa:update', (event) => {
  $('status').textContent = `Status: ${event.status}`
  if (event.qr) $('qr').src = event.qr
  if (event.pairCode) $('pair').textContent = `Pairing code: ${event.pairCode}`
  if (event.status === 'connected') setConnectedUI(true)
  if (event.status === 'disconnected') setConnectedUI(false)
})

async function loadLogs() {
  const res = await fetch('/api/messages/recent')
  const data = await res.json()
  $('logs').textContent = JSON.stringify(data.rows || [], null, 2)
}

loadLogs()
setConnectedUI(false)
