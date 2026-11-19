// Shared plumbing for the `gemini/*` adapters (gemini.google.com).
//
// Everything is read from the elements Gemini renders a conversation with:
// a `.conversation-container` per turn, holding a `user-query` and a
// `model-response` whose text sits in `message-content`. Nothing here falls
// back to the page's text as a whole: the side navigation lists recent
// conversations, and a reader that diffs page text returns those titles as
// "the answer" (chrome-use #904). If the answer element is not there, the
// adapters say so.

const GM_APP = 'https://gemini.google.com/app'

/** A wait with jitter: `ms` plus up to 30% more. */
function gmSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms + Math.floor(Math.random() * ms * 0.3)))
}

function gmText(el) {
  return String((el && (el.innerText || el.textContent)) || '').replace(/ /g, ' ').trim()
}

function gmVisible(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

function gmAll(selector) {
  return Array.prototype.slice.call(document.querySelectorAll(selector))
}

/**
 * A dialog that is open over the page, or null: `{title, text, buttons}`.
 * Gemini shows these for consent and onboarding (for example "解锁最适合你的
 * Gemini" with two buttons). Which button to press is the user's decision, so
 * the adapters report the dialog and touch nothing.
 */
function gmDialog() {
  const found = gmAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"], mat-dialog-container').filter(gmVisible)
  if (!found.length) return null
  // The outermost one: a dialog's own panels match the selector too.
  const dialog = found.find((el) => !found.some((other) => other !== el && other.contains(el))) || found[0]
  const heading = dialog.querySelector('h1, h2, h3, [role="heading"], [mat-dialog-title], .mat-mdc-dialog-title')
  const buttons = Array.prototype.slice.call(dialog.querySelectorAll('button, [role="button"], a[href]'))
    .filter(gmVisible)
    .map((b) => gmText(b) || String(b.getAttribute('aria-label') || '').trim())
    .filter(Boolean)
  return {
    title: gmText(heading) || String(dialog.getAttribute('aria-label') || '').trim() || null,
    text: gmText(dialog).slice(0, 400),
    buttons: buttons.filter((b, i) => buttons.indexOf(b) === i).slice(0, 8),
  }
}

/** The error every adapter returns when a dialog is in the way. */
function gmBlocked(dialog, what) {
  return {
    error: 'A dialog is open over the Gemini page' + (dialog.title ? ': "' + dialog.title + '"' : ''),
    status: 'blocked_by_dialog',
    dialog,
    hint: what + ' Decide in the page which of its buttons to press (' +
      (dialog.buttons.length ? dialog.buttons.map((b) => '"' + b + '"').join(' / ') : 'none found') +
      '), then run the command again. The adapter does not choose for you.',
  }
}

/** The prompt box, or null. */
function gmComposer() {
  return gmAll('.ql-editor[contenteditable="true"], rich-textarea [contenteditable="true"]').find(gmVisible) || null
}

/** Whether the page shows a sign-in link instead of the app. */
function gmSignedOut() {
  return gmAll('a[href*="accounts.google.com/ServiceLogin"], a[href*="accounts.google.com/signin"]').some(gmVisible)
}

/** The button Gemini shows while it is answering ("停止回答" / "Stop response"). */
function gmGenerating() {
  return gmAll('button[aria-label]').some((b) => {
    const label = String(b.getAttribute('aria-label') || '').toLowerCase()
    return gmVisible(b) && (label.indexOf('停止') === 0 || label.indexOf('stop') === 0)
  })
}

/** Every turn's container, in page order. */
function gmContainers() {
  return gmAll('#chat-history .conversation-container, infinite-scroller .conversation-container')
}

/** `{role, text}` for each side of each turn, read only from the turn elements. */
function gmTurns() {
  const turns = []
  for (const box of gmContainers()) {
    const query = box.querySelector('user-query')
    if (query) {
      // The lines of the prompt. `.query-text` as a whole also holds a
      // screen-reader heading ("你说 …") that repeats it.
      const lines = Array.prototype.slice.call(query.querySelectorAll('.query-text-line')).map(gmText)
      const text = lines.length ? lines.join('\n').trim() : gmText(query.querySelector('.query-text') || query)
      if (text) turns.push({ role: 'user', text })
    }
    const answer = gmAnswer(box)
    if (answer && answer.text) turns.push({ role: 'assistant', text: answer.text })
  }
  return turns
}

/**
 * The answer inside one turn container: `{text, complete}`, or null when the
 * turn has no `model-response` yet. `complete` is Gemini's own marker: the
 * footer it adds under a finished answer.
 */
function gmAnswer(box) {
  const response = box && box.querySelector('model-response')
  if (!response) return null
  const content = response.querySelector('message-content')
  return {
    text: gmText(content && (content.querySelector('.markdown') || content)),
    complete: !!response.querySelector('.response-footer.complete, message-actions copy-button'),
  }
}

/** The conversation open in the tab: `{id, url}`, or null on the new-chat page. */
function gmConversation() {
  const m = String(window.location.pathname || '').match(/^\/app\/([0-9a-z_-]{6,})/i)
  return m ? { id: m[1], url: GM_APP + '/' + m[1] } : null
}

/** Recent conversations from the side navigation: `{title, id, url}`. */
function gmHistory() {
  const out = []
  const seen = {}
  for (const item of gmAll('[data-test-id="conversation"]')) {
    const link = (item.matches && item.matches('a[href]')) ? item : item.querySelector('a[href*="/app/"]')
    const href = link && String(link.getAttribute('href') || '')
    const m = href && href.match(/\/app\/([0-9a-z_-]{6,})/i)
    if (!m || seen[m[1]]) continue
    seen[m[1]] = true
    out.push({
      title: String((link.getAttribute('aria-label') || gmText(link) || gmText(item))).replace(/\s+/g, ' ').trim(),
      id: m[1],
      url: GM_APP + '/' + m[1],
    })
  }
  return out
}

/**
 * Common start of every adapter: wait (bounded) for the app, then return null
 * when it can be used, or the `{error, hint}` to return.
 */
async function gmReady(needComposer) {
  for (let i = 0; i < 16; i++) {
    if (gmComposer() || gmDialog() || gmSignedOut()) break
    if (!needComposer && gmAll('[data-test-id="conversation"]').length) break
    await gmSleep(250)
  }
  if (gmSignedOut() || (!gmComposer() && !gmDialog() && !gmAll('[data-test-id="conversation"]').length)) {
    return {
      error: gmSignedOut() ? 'Not signed in to gemini.google.com' : 'The Gemini app did not load in this tab',
      hint: 'Open https://gemini.google.com/app in this browser, sign in if asked, then run the command again.',
    }
  }
  return null
}
