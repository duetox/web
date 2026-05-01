const socket = io(); const $ = (id) => document.getElementById(id)
const state = { token:'', sessionKey:'', messages:[] }
const show = (id, on=true) => $(id).classList.toggle('hidden', !on)

async function bootstrap() { const data = await (await fetch('/api/bootstrap')).json(); $('accounts').textContent = JSON.stringify(data.accounts,null,2) }
bootstrap()

async function refreshCommands(){
  if(!state.token) return
  const data = await (await fetch(`/api/commands?token=${state.token}`)).json()
  if(data.ok) $('commandsList').textContent = JSON.stringify(data.rows,null,2)
}

$('newAccount').onclick = async () => {
  const data = await (await fetch('/api/auth/first-time',{method:'POST'})).json()
  state.sessionKey = data.sessionKey
  $('creds').textContent = `${data.notice} Username: ${data.username}`
  show('onboardingView', true); show('loginView', false); show('chatView', false)
}

$('pairCode').onclick = async ()=>{
  const phoneNumber = $('phoneNumber').value.trim()
  const data = await (await fetch('/api/session/pair-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionKey:state.sessionKey, phoneNumber})})).json()
  $('pair').textContent = data.ok ? `Pair code: ${data.code}` : data.error
}

$('login').onclick = async ()=>{
  const payload = {username:$('username').value.trim(), password:$('password').value}
  const data = await (await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})).json()
  if(!data.ok) return alert(data.error)
  state.token = data.token; state.sessionKey = data.sessionKey
  show('chatView', true); show('loginView', false); show('onboardingView', false)
  $('status').textContent = `Connected as ${data.profile.username}`
  refreshCommands()
}

$('logout').onclick = async ()=>{ if(!state.token) return; await fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:state.token})}); state.token=''; show('loginView',true); show('chatView',false)}

$('send').onclick = async ()=>{
  const jid = $('jid').value.trim(); const text = $('message').value; const type = $('payloadType').value; const url = $('mediaUrl').value.trim()
  const payload = type === 'text' ? {type:'text', text} : {type, url, caption:text}
  const data = await (await fetch('/api/message/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:state.token,jid,payload})})).json()
  if(!data.ok) alert(data.error)
}

$('saveCommand').onclick = async ()=>{
  const command = $('commandName').value.trim(); const responseType = $('commandType').value
  const responsePayload = responseType === 'text' ? { text: $('commandBody').value } : { url: $('commandMediaUrl').value.trim(), caption: $('commandBody').value }
  const data = await (await fetch('/api/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:state.token,command,responseType,responsePayload})})).json()
  if(!data.ok) return alert(data.error)
  refreshCommands()
}

socket.on('wa:update', (e)=>{
  if(e.sessionKey !== state.sessionKey) return
  if(e.qr) $('qr').src = e.qr
  $('status').textContent = `Status: ${e.status}`
})
socket.on('chat:event', (e)=>{ if(e.sessionKey===state.sessionKey){ state.messages.unshift(e); $('events').textContent = JSON.stringify(state.messages.slice(0,40),null,2) } })
