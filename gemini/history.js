/* @meta
{
  "name": "gemini/history",
  "description": "Recent Gemini conversations from the side navigation: title, id and URL",
  "domain": "gemini.google.com",
  "args": {
    "limit": {"required": false, "description": "How many to return (default 20, max 100; only what the side navigation has loaded)"}
  },
  "capabilities": ["dom"],
  "world": "isolated",
  "readOnly": true,
  "example": "chrome-use site gemini/history --limit 10"
}
*/

async function(args) {
  args = args || {}
  const notReady = await gmReady(false)
  if (notReady) return notReady
  for (let i = 0; i < 12 && !gmHistory().length; i++) await gmSleep(250)
  const all = gmHistory()
  if (!all.length) {
    const dialog = gmDialog()
    if (dialog) return gmBlocked(dialog, 'The conversation list could not be read.')
    return {
      error: 'No conversation is listed in the side navigation',
      hint: 'The list is empty or collapsed. Open the side navigation in the Gemini tab (and its recent section), then run the command again.',
    }
  }
  const n = Number(args.limit)
  const limit = Number.isInteger(n) && n > 0 ? Math.min(n, 100) : 20
  return { count: Math.min(all.length, limit), loaded: all.length, conversations: all.slice(0, limit) }
}
