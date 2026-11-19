/* @meta
{
  "name": "gemini/ask",
  "description": "Send one prompt to Gemini as the signed-in account and return its answer, read from the answer element only. Fails instead of returning other page text; reports a dialog that blocks the page without pressing anything in it",
  "domain": "gemini.google.com",
  "timeout": 300,
  "args": {
    "prompt": {"required": true, "description": "The prompt to send. It is typed with real key presses at about 7 characters a second, so a long one takes time: raise --timeout to cover the typing and the answer"},
    "fresh": {"required": false, "description": "true: start a new conversation first (default false: continue the one open in the tab). Not called --new: that is a chrome-use global flag and never reaches an adapter"}
  },
  "capabilities": ["dom"],
  "world": "isolated",
  "readOnly": false,
  "example": "chrome-use site gemini/ask \"Summarise this in one line: ...\" --fresh true --timeout 400"
}
*/

async function(args) {
  args = args || {}
  const prompt = String(args.prompt == null ? '' : args.prompt)
  if (!prompt.trim()) return { error: 'The prompt is empty', hint: 'Pass the prompt as the first argument.' }
  const UI = args.ui
  if (!UI || typeof UI.type !== 'function' || typeof UI.press !== 'function') {
    return { error: 'gemini/ask needs chrome-use 1.5.259 or newer (trusted input)', hint: 'Upgrade chrome-use. Nothing was sent.' }
  }
  const startFresh = ['true', '1', 'yes', 'on'].indexOf(String(args.fresh == null ? '' : args.fresh).trim().toLowerCase()) !== -1
  const started = Date.now()
  // The runner's deadline for this run; the adapter answers before it.
  const budget = (typeof args.budgetMs === 'number' && args.budgetMs > 0 ? args.budgetMs : 290000) - 3000
  const left = () => budget - (Date.now() - started)

  const notReady = await gmReady(true)
  if (notReady) return notReady
  // Before anything is typed: a dialog over the page swallows the input, and
  // which of its buttons to press is not this adapter's call.
  let dialog = gmDialog()
  if (dialog) return gmBlocked(dialog, 'Nothing was typed or sent.')
  if (gmGenerating()) {
    return { error: 'Gemini is still answering in this tab', hint: 'Wait for it to finish (gemini/read shows the conversation), then ask again. Nothing was sent.' }
  }

  if (startFresh && (gmContainers().length || gmConversation())) {
    const fresh = gmAll('a[href="/app"], a[href$="/app"]').filter(gmVisible)[0] ||
      gmAll('a[aria-label], button[aria-label]').filter((el) => {
        const label = String(el.getAttribute('aria-label') || '').trim().toLowerCase()
        return gmVisible(el) && (label === 'new chat' || label === '发起新对话' || label === '新对话')
      })[0]
    if (!fresh) return { error: 'Cannot find the "new chat" control', hint: 'Open https://gemini.google.com/app in the tab, then ask without --fresh. Nothing was sent.' }
    await UI.click(fresh)
    for (let i = 0; i < 20 && (gmContainers().length || gmConversation()); i++) await gmSleep(250)
    if (gmContainers().length || gmConversation()) {
      return { error: 'The new conversation did not open', hint: 'Open https://gemini.google.com/app in the tab, then ask without --fresh. Nothing was sent.' }
    }
    dialog = gmDialog()
    if (dialog) return gmBlocked(dialog, 'Nothing was typed or sent.')
  }

  const composer = gmComposer()
  if (!composer) return { error: 'Cannot find the Gemini prompt box', hint: 'Open https://gemini.google.com/app in the tab and check that it shows the prompt box. Nothing was sent.' }
  if (gmText(composer)) {
    return { error: 'The prompt box already holds text', hint: 'Clear or send what is in the Gemini prompt box, then ask again. Nothing was sent.' }
  }

  const before = gmContainers().length
  // Typing is paced like a person's, measured at about 7 characters a second.
  // A prompt that cannot be typed and answered in the time this run has is
  // refused before the first key, not abandoned half typed.
  const typingMs = Math.ceil(prompt.length / 5) * 1000
  if (typingMs + 20000 > left()) {
    return {
      error: 'This run does not have the time to type the prompt (' + prompt.length + ' characters, about ' + Math.ceil(typingMs / 1000) + ' s) and wait for an answer',
      status: 'not_sent',
      hint: 'Nothing was typed or sent. Run again with --timeout ' + (Math.ceil(typingMs / 1000) + 120) + ' or more.',
    }
  }
  if (args.progress) args.progress('typing ' + prompt.length + ' characters')
  // A line break in the box would submit, so the prompt goes in as one line
  // per paragraph, joined with Shift+Enter.
  const lines = prompt.replace(/\r\n?/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (i === 0) await UI.type(composer, lines[i])
    else {
      await UI.press('Shift+Enter')
      if (lines[i]) await UI.typeHere(lines[i])
    }
    if (left() < 10000) {
      return {
        error: 'Typing the prompt used up the time for this run',
        status: 'not_sent',
        hint: 'The prompt was not sent; part of it is in the Gemini prompt box. Clear the box and run again with a larger --timeout (about 1 s per 5 characters, plus the answer).',
      }
    }
  }
  const typed = gmText(composer).replace(/\s+/g, '')
  if (typed.length < prompt.replace(/\s+/g, '').length * 0.9) {
    dialog = gmDialog()
    if (dialog) return gmBlocked(dialog, 'The prompt was not sent.')
    return {
      error: 'The prompt box does not hold the prompt after typing (' + typed.length + ' of ' + prompt.replace(/\s+/g, '').length + ' characters)',
      status: 'not_sent',
      hint: 'Nothing was sent. Look at the Gemini tab: something took the focus or changed the box.',
    }
  }

  await UI.press('Enter')
  // Sent once a new turn appears. From here on the prompt is with Gemini:
  // every failure below says so, and nothing is ever sent a second time.
  // The new turn is looked up by its position on every read: Gemini replaces
  // the turn's element once the conversation has an id, and an element kept
  // from before that never receives the answer.
  const newTurn = () => {
    const boxes = gmContainers()
    const box = boxes.length > before ? boxes[boxes.length - 1] : null
    return box && box.querySelector('user-query') ? box : null
  }
  for (let i = 0; i < 40 && !newTurn(); i++) await gmSleep(250)
  if (!newTurn()) {
    dialog = gmDialog()
    const stillThere = !!gmText(gmComposer())
    return Object.assign(dialog ? gmBlocked(dialog, 'The prompt was typed and Enter was pressed, but no new turn appeared.') : {
      error: 'Enter was pressed but no new turn appeared in the conversation',
    }, {
      status: stillThere ? 'not_sent' : 'outcome_unknown',
      sent: stillThere ? false : null,
      hint: stillThere
        ? 'The prompt is still in the Gemini prompt box and was not sent. Look at the tab before trying again.'
        : 'The prompt box is empty, so the prompt may have been sent. Check with gemini/read or gemini/history before asking again.',
    })
  }
  if (args.progress) args.progress('sent, waiting for the answer')

  const sentNote = 'The prompt was sent; do not send it again.'
  let last = ''
  let stable = 0
  for (;;) {
    const answer = gmAnswer(newTurn())
    const generating = gmGenerating()
    if (answer && answer.text && answer.complete && !generating) {
      stable = answer.text === last ? stable + 1 : 0
      last = answer.text
      if (stable >= 2) {
        const conversation = gmConversation()
        return {
          response: answer.text,
          conversation_id: conversation ? conversation.id : null,
          conversation_url: conversation ? conversation.url : null,
          sent: true,
          elapsed_ms: Date.now() - started,
        }
      }
    } else {
      stable = 0
      if (answer && answer.text) last = answer.text
    }
    if (left() < 1500) {
      const conversation = gmConversation()
      dialog = gmDialog()
      return {
        error: (last ? 'Gemini had not finished answering' : 'No answer appeared in the conversation') + ' when the time for this run ended',
        status: 'answer_not_read',
        sent: true,
        partial: last || null,
        dialog: dialog || undefined,
        conversation_url: conversation ? conversation.url : null,
        hint: sentNote + ' Read the answer later with gemini/read' + (dialog ? '; a dialog is open over the page ("' + (dialog.title || '') + '").' : '.'),
      }
    }
    await gmSleep(700)
  }
}
