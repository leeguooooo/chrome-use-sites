/* @meta
{
  "name": "gemini/read",
  "description": "The conversation open in the Gemini tab, turn by turn, read from the turn elements only",
  "domain": "gemini.google.com",
  "args": {
    "last": {"required": false, "description": "Only the last N turns (default: all that are loaded)"}
  },
  "capabilities": ["dom"],
  "world": "isolated",
  "readOnly": true,
  "example": "chrome-use site gemini/read --last 2"
}
*/

async function(args) {
  args = args || {}
  const notReady = await gmReady(false)
  if (notReady) return notReady
  const dialog = gmDialog()
  const conversation = gmConversation()
  // A conversation opened by URL renders its turns a moment after the app.
  for (let i = 0; i < 12 && conversation && !gmContainers().length; i++) await gmSleep(250)
  const turns = gmTurns()
  if (!turns.length) {
    if (dialog) return gmBlocked(dialog, 'No turn of the conversation could be read.')
    return {
      error: conversation ? 'No turn could be read from this conversation' : 'No conversation is open in the tab',
      hint: conversation
        ? 'The conversation did not render its turns. Look at the Gemini tab, then run the command again.'
        : 'This is the new-chat page. Open a conversation with gemini/detail, or ask with gemini/ask.',
    }
  }
  const n = Number(args.last)
  const shown = Number.isInteger(n) && n > 0 ? turns.slice(-n) : turns
  return {
    conversation_id: conversation ? conversation.id : null,
    conversation_url: conversation ? conversation.url : null,
    generating: gmGenerating(),
    count: shown.length,
    total_loaded: turns.length,
    dialog: dialog || undefined,
    turns: shown,
  }
}
