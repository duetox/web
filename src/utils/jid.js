export function normalizeJid(input) {
  if (!input) return null
  const trimmed = input.trim()
  if (trimmed.includes('@s.whatsapp.net') || trimmed.includes('@g.us')) return trimmed
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return null
  return `${digits}@s.whatsapp.net`
}
