export const guruPluginCommands = [
  '.sticker','.ai','.facebook','.insta','.play','.tiktok','.yta','.ytsearch','.ytv','.enable','.add','.delete','.delwarn','.demote','.groupinfo','.hidetag','.invite','.kick','.link','.poll','.gpprofile','.promote','.resetlink','.setbye','.settings','.setwelcome','.simulate','.staff','.tagall','.totag','.warning','.warns','.guru','.alive','.botinfo','.creator','.feature','.list','.menu','.ping','.runtime','.script','.server','.addsudo','.allow','.banuser','.banchat','.blocklist','.broadcast','.broadcastgc','.exec','.getfile','.inspect','.join','.resetuser','.resetprefix','.restart','.setprefix','.setprivacy','.unblock','.unbanuser','.unbanchat'
]

export function buildGuruSeedRules() {
  return guruPluginCommands.map((cmd) => ({
    command: cmd,
    responseType: 'text',
    responsePayload: JSON.stringify({
      text: `✅ ${cmd} command imported from Guru plugin pack. Configure a custom response in Add Commands to override this default.`
    })
  }))
}
