/* @meta
{
  "name": "gemini/detail",
  "description": "Open one Gemini conversation, by its URL, id or a title from gemini/history, and return its turns. Run with --until-done: the first run opens the conversation and the rerun reads it",
  "domain": "gemini.google.com",
  "retryStatuses": ["navigating"],
  "args": {
    "conversation": {"required": true, "description": "A gemini.google.com/app/<id> URL, the id, or a conversation title (exact match first, then the only title containing it)"},
    "last": {"required": false, "description": "Only the last N turns (default: all that are loaded)"}
  },
  "capabilities": ["dom"],
  "world": "isolated",
  "readOnly": true,
  "example": "chrome-use site gemini/detail \"Trip plan\" --until-done"
}
*/

async function(args) {
  args = args || {}
  const wanted = String(args.conversation == null ? '' : args.conversation).trim()
  if (!wanted) return { error: 'No conversation was named', hint: 'Pass a gemini.google.com/app/<id> URL, an id, or a title from gemini/history.' }
  const notReady = await gmReady(false)
  if (notReady) return notReady

  let id = null
  const fromUrl = wanted.match(/gemini\.google\.com\/app\/([0-9a-z_-]{6,})/i)
  if (fromUrl) id = fromUrl[1]
  else if (/^[0-9a-f]{12,}$/i.test(wanted)) id = wanted
  else {
    for (let i = 0; i < 12 && !gmHistory().length; i++) await gmSleep(250)
    const all = gmHistory()
    const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase()
    const exact = all.filter((c) => norm(c.title) === norm(wanted))
    const partial = exact.length ? exact : all.filter((c) => norm(c.title).indexOf(norm(wanted)) !== -1)
    if (partial.length !== 1) {
      const dialog = gmDialog()
      if (!all.length && dialog) return gmBlocked(dialog, 'The conversation list could not be read.')
      return {
        error: partial.length
          ? partial.length + ' conversations match "' + wanted + '"'
          : 'No conversation in the side navigation matches "' + wanted + '"',
        matches: partial.slice(0, 10),
        hint: partial.length
          ? 'Pass the id or URL of the one you mean.'
          : 'Only the ' + all.length + ' conversations the side navigation has loaded are searched. Use gemini/history, or pass the conversation URL.',
      }
    }
    id = partial[0].id
  }

  const here = gmConversation()
  if (!here || here.id !== id) {
    const url = GM_APP + '/' + id
    // A read-only step: opening a conversation changes nothing in it.
    setTimeout(() => window.location.assign(url), 400 + Math.floor(Math.random() * 400))
    return { status: 'navigating', url, retryAfterMs: 4000, hint: 'Opening the conversation; run the same command again there, or pass --until-done.' }
  }

  for (let i = 0; i < 16 && !gmContainers().length; i++) await gmSleep(250)
  const turns = gmTurns()
  const dialog = gmDialog()
  if (!turns.length) {
    if (dialog) return gmBlocked(dialog, 'No turn of the conversation could be read.')
    return { error: 'No turn could be read from conversation ' + id, hint: 'It may not exist for this account, or did not render. Look at the Gemini tab.' }
  }
  const n = Number(args.last)
  const shown = Number.isInteger(n) && n > 0 ? turns.slice(-n) : turns
  return {
    conversation_id: id,
    conversation_url: here.url,
    generating: gmGenerating(),
    count: shown.length,
    total_loaded: turns.length,
    dialog: dialog || undefined,
    turns: shown,
  }
}
