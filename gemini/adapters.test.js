import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

// The gemini adapters drive a real signed-in account, so they are checked
// here against a stubbed page shaped like gemini.google.com as surveyed on
// 2026-11-19: a side navigation with recent conversations, a `.ql-editor`
// prompt box, and one `.conversation-container` per turn holding a
// `user-query` and a `model-response`.

const HELPER = fs.readFileSync(new URL('./_helper.js', import.meta.url), 'utf8')

// ---- a small DOM ----------------------------------------------------------

class El {
  constructor(tag, attrs = {}, children = [], text = '') {
    this.tagName = tag.toUpperCase()
    this.attrs = { ...attrs }
    this.children = []
    this.parent = null
    this.own = text
    this.shown = true
    for (const c of children) this.append(c)
  }
  append(c) { c.parent = this; this.children.push(c); return c }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null }
  get id() { return this.attrs.id || '' }
  get className() { return this.attrs.class || '' }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null }
  get innerText() { return [this.own, ...this.children.filter((c) => c.shown).map((c) => c.innerText)].filter(Boolean).join('\n') }
  get textContent() { return this.innerText }
  getBoundingClientRect() {
    for (let n = this; n; n = n.parent) if (!n.shown) return { width: 0, height: 0 }
    return { width: 100, height: 20 }
  }
  contains(o) { for (let n = o; n; n = n.parent) if (n === this) return true; return false }
  descendants() { return this.children.flatMap((c) => [c, ...c.descendants()]) }
  matches(sel) { return sel.split(',').some((s) => matchChain(this, s.trim().split(/\s+/))) }
  querySelectorAll(sel) { return this.descendants().filter((el) => el.matches(sel)) }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null }
}

function matchCompound(el, part) {
  const m = part.match(/^([a-z0-9-]+)?((?:[#.][\w-]+|\[[^\]]+\])*)$/i)
  if (!m) throw new Error('selector not supported by the test DOM: ' + part)
  if (m[1] && el.tagName !== m[1].toUpperCase()) return false
  for (const bit of m[2].match(/[#.][\w-]+|\[[^\]]+\]/g) || []) {
    if (bit[0] === '#') { if (el.id !== bit.slice(1)) return false }
    else if (bit[0] === '.') { if (!el.className.split(/\s+/).includes(bit.slice(1))) return false }
    else {
      const a = bit.slice(1, -1).match(/^([\w-]+)(?:([*^$]?=)"([^"]*)")?$/)
      if (!a) throw new Error('attribute selector not supported by the test DOM: ' + bit)
      const v = el.getAttribute(a[1])
      if (v === null) return false
      if (a[2] === '=' && v !== a[3]) return false
      if (a[2] === '*=' && !v.includes(a[3])) return false
      if (a[2] === '^=' && !v.startsWith(a[3])) return false
      if (a[2] === '$=' && !v.endsWith(a[3])) return false
    }
  }
  return true
}

function matchChain(el, parts) {
  if (!matchCompound(el, parts[parts.length - 1])) return false
  if (parts.length === 1) return true
  for (let n = el.parent; n; n = n.parent) if (matchChain(n, parts.slice(0, -1))) return true
  return false
}

const h = (tag, attrs, children, text) => new El(tag, attrs, children, text)

// ---- the page -------------------------------------------------------------

const SIDEBAR_TITLES = ['Trip plan', 'Trip plan for Kyoto', 'Fast Ludo protocol review']

function turnBox(id, prompt, answer, complete) {
  const kids = [h('user-query', {}, [h('div', { class: 'query-text' }, [
    h('h5', { class: 'cdk-visually-hidden' }, [], '你说 ' + prompt),
    ...prompt.split('\n').map((line) => h('p', { class: 'query-text-line' }, [], line)),
  ])])]
  if (answer !== null) {
    kids.push(h('model-response', {}, [
      h('message-content', { id: 'message-content-id-r_' + id }, [h('div', { class: 'markdown' }, [], answer)]),
      ...(complete ? [h('div', { class: 'response-footer complete' }, [h('message-actions', {}, [h('copy-button')])])] : []),
    ]))
  }
  return h('div', { class: 'conversation-container', id }, kids)
}

/** A Gemini tab. `turns`: [[prompt, answer]] already in the conversation. */
function page({ path = '/app', turns = [], dialog = null, signedOut = false, titles = SIDEBAR_TITLES } = {}) {
  const history = h('infinite-scroller', { class: 'chat-history' }, turns.map(([q, a], i) => turnBox('t' + i, q, a, true)))
  const composer = h('div', { class: 'ql-editor textarea', contenteditable: 'true', role: 'textbox', 'aria-label': '为 Gemini 输入提示' })
  const stop = h('button', { 'aria-label': '停止回答' })
  stop.shown = false
  const newChat = h('a', { href: '/app', 'aria-label': '发起新对话' }, [], '发起新对话')
  const list = h('conversations-list', {}, titles.map((title, i) =>
    h('gem-nav-list-item', { 'data-test-id': 'conversation' }, [h('a', { href: '/app/' + (0xabc0000000 + i).toString(16) + 'aa', 'aria-label': title }, [], title)])))
  const body = h('body', {}, [
    h('side-navigation-v2', {}, [newChat, list]),
    h('chat-window', {}, [h('div', { id: 'chat-history' }, [history]), h('input-area-v2', {}, [h('rich-textarea', {}, [composer]), stop])]),
  ])
  if (signedOut) {
    composer.remove()
    list.remove()
    body.append(h('a', { href: 'https://accounts.google.com/ServiceLogin?continue=x' }, [], '登录'))
  }
  if (dialog) body.append(dialogEl(dialog))
  const assigned = []
  const window = { location: { pathname: path, assign: (u) => assigned.push(u) } }
  return { document: body, window, history, composer, stop, newChat, list, body, assigned }
}

function dialogEl({ title, buttons }) {
  return h('mat-dialog-container', { role: 'dialog', 'aria-modal': 'true' }, [
    h('h2', {}, [], title),
    h('p', {}, [], '关联内容应用后，Gemini 可以……'),
    ...buttons.map((b) => h('button', {}, [], b)),
  ])
}

/**
 * How the page reacts to input. `answer`: what Gemini replies; `after`: how
 * many timer ticks it takes; `replace`: swap the turn's element when the
 * answer arrives, as the live page does; `eat`: typing goes nowhere.
 */
function drive(p, { answer = 'pong', after = 4, replace = true, eat = false, never = false, dialogAfterSend = null, enterDoes = true } = {}) {
  const log = { calls: [], ticks: 0, sent: [] }
  let pending = null
  const ui = {
    click: async (el) => {
      log.calls.push(['click', el.getAttribute('aria-label') || el.tagName])
      if (el === p.newChat) { p.history.children = []; p.window.location.pathname = '/app' }
    },
    type: async (el, text) => { log.calls.push(['type', text]); if (!eat) el.own += text },
    typeHere: async (text) => { log.calls.push(['typeHere', text]); if (!eat) p.composer.own += text },
    press: async (key) => {
      log.calls.push(['press', key])
      if (key === 'Shift+Enter') { if (!eat) p.composer.own += '\n'; return }
      if (key !== 'Enter' || !enterDoes || !p.composer.own) return
      const prompt = p.composer.own
      log.sent.push(prompt)
      p.composer.own = ''
      const box = p.history.append(turnBox('new', prompt, null, false))
      p.stop.shown = true
      // A new conversation appears in the side navigation as soon as it is
      // sent: the text a page-wide reader mistook for the answer (#904).
      p.list.children.unshift(h('gem-nav-list-item', { 'data-test-id': 'conversation' }, [h('a', { href: '/app/feedfacefeedface', 'aria-label': 'SIDEBAR ONLY TITLE' }, [], 'SIDEBAR ONLY TITLE')]))
      p.list.children[0].parent = p.list
      if (dialogAfterSend) p.body.append(dialogEl(dialogAfterSend))
      pending = { box, prompt, at: log.ticks + after }
    },
  }
  const tick = () => {
    log.ticks++
    if (!pending || never || log.ticks < pending.at) return
    const done = turnBox('cdb0ba906052bc20', pending.prompt, answer, true)
    if (replace) {
      const i = p.history.children.indexOf(pending.box)
      pending.box.parent = null
      done.parent = p.history
      p.history.children[i] = done
    } else {
      for (const c of done.children.slice(1)) pending.box.append(c)
    }
    p.window.location.pathname = '/app/cdb0ba906052bc20'
    p.stop.shown = false
    pending = null
  }
  return { ui, log, tick }
}

// Time runs on timers: every wait is a tick of the page and 300 ms on the
// clock, so a run that waits out its budget ends at once.
function loadAdapter(file, p, tick = () => {}) {
  let now = 1_000_000
  const clock = { now: () => now }
  const timeout = (fn) => { now += 300; tick(); setImmediate(fn) }
  const src = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
  return new Function('window', 'document', 'Date', 'setTimeout', `${HELPER}\n;return (${src})`)(p.window, p.document, clock, timeout)
}

const ask = (p, d, args) => loadAdapter('./ask.js', p, d.tick)({ ui: d.ui, budgetMs: 120000, ...args })

// ---- ask ------------------------------------------------------------------

test('ask types the prompt, sends it once and returns the answer element\'s text', async () => {
  const p = page()
  const d = drive(p, { answer: 'pong' })
  const r = await ask(p, d, { prompt: 'Reply with exactly one word: pong' })
  assert.equal(r.error, undefined, JSON.stringify(r))
  assert.equal(r.response, 'pong')
  assert.equal(r.sent, true)
  assert.equal(r.conversation_url, 'https://gemini.google.com/app/cdb0ba906052bc20')
  assert.deepEqual(d.log.sent, ['Reply with exactly one word: pong'])
  assert.equal(d.log.calls.filter((c) => c[0] === 'press' && c[1] === 'Enter').length, 1)
})

test('the answer is found although Gemini replaces the turn element while answering', async () => {
  // Seen live on 2026-11-19: an adapter that kept the element of the turn it
  // had just sent never saw the answer and ran out its 300 s.
  for (const replace of [true, false]) {
    const p = page({ path: '/app/aaaabbbbccccdddd', turns: [['earlier', 'earlier answer']] })
    const d = drive(p, { answer: 'alpha beta', replace })
    const r = await ask(p, d, { prompt: 'two words' })
    assert.equal(r.response, 'alpha beta', 'replace=' + replace)
  }
})

test('a multi-line prompt is typed with Shift+Enter between lines and sent whole', async () => {
  const p = page()
  const d = drive(p)
  const r = await ask(p, d, { prompt: 'line one\nline two\n\nline four' })
  assert.equal(r.response, 'pong')
  assert.deepEqual(d.log.sent, ['line one\nline two\n\nline four'])
  assert.equal(d.log.calls.filter((c) => c[1] === 'Shift+Enter').length, 3)
})

test('#904: a dialog over the page is reported with its title and buttons, and nothing is typed or pressed', async () => {
  const p = page({ dialog: { title: '解锁最适合你的 Gemini', buttons: ['不关联内容应用，直接使用', '继续'] } })
  const d = drive(p)
  const r = await ask(p, d, { prompt: 'hello' })
  assert.equal(r.status, 'blocked_by_dialog')
  assert.match(r.error, /解锁最适合你的 Gemini/)
  assert.deepEqual(r.dialog.buttons, ['不关联内容应用，直接使用', '继续'])
  assert.match(r.hint, /Nothing was typed or sent/)
  assert.match(r.hint, /does not choose for you/)
  assert.deepEqual(d.log.calls, [], 'no click, no key')
  assert.equal(r.response, undefined)
})

test('#904: when no answer element appears, ask fails and never returns sidebar text', async () => {
  // The prompt goes out, a dialog opens over the page and the answer cannot
  // be read. The side navigation has a new title by then.
  const p = page()
  const d = drive(p, { never: true, dialogAfterSend: { title: '解锁最适合你的 Gemini', buttons: ['继续'] } })
  const r = await ask(p, d, { prompt: 'a long prompt' })
  assert.match(r.error, /No answer appeared/)
  assert.equal(r.status, 'answer_not_read')
  assert.equal(r.sent, true)
  assert.equal(r.response, undefined)
  assert.equal(r.partial, null)
  assert.equal(r.dialog.title, '解锁最适合你的 Gemini')
  assert.match(r.hint, /do not send it again/)
  assert.ok(!JSON.stringify({ ...r, dialog: undefined }).includes('SIDEBAR ONLY TITLE'))
  assert.ok(!JSON.stringify(r).includes('Trip plan'))
  assert.equal(d.log.sent.length, 1, 'never sent twice')
})

test('an answer still being written when time runs out is an error with the partial text', async () => {
  const p = page()
  const d = drive(p, { never: true })
  d.ui.press = (async (orig) => async (key) => {
    await orig(key)
    if (key === 'Enter') p.history.children[p.history.children.length - 1].append(
      h('model-response', {}, [h('message-content', {}, [h('div', { class: 'markdown' }, [], 'The first half')])]))
  })(d.ui.press)
  d.ui.press = await d.ui.press
  const r = await ask(p, d, { prompt: 'write an essay' })
  assert.match(r.error, /had not finished answering/)
  assert.equal(r.partial, 'The first half')
  assert.equal(r.response, undefined)
  assert.equal(r.sent, true)
})

test('--fresh true opens a new conversation first; without it the open one continues', async () => {
  const open = () => page({ path: '/app/aaaabbbbccccdddd', turns: [['old question', 'old answer']] })
  let p = open()
  let d = drive(p)
  let r = await ask(p, d, { prompt: 'hi', fresh: 'true' })
  assert.equal(r.response, 'pong')
  assert.deepEqual(d.log.calls[0], ['click', '发起新对话'])
  assert.equal(p.history.children.length, 1, 'only the new turn')

  p = open()
  d = drive(p)
  r = await ask(p, d, { prompt: 'hi' })
  assert.equal(r.response, 'pong')
  assert.ok(!d.log.calls.some((c) => c[0] === 'click'))
  assert.equal(p.history.children.length, 2, 'the earlier turn is still there')

  // The new-chat control does nothing: stop before typing.
  p = open()
  d = drive(p)
  d.ui.click = async () => {}
  r = await ask(p, d, { prompt: 'hi', fresh: 'true' })
  assert.match(r.error, /new conversation did not open/)
  assert.deepEqual(d.log.sent, [])
})

test('ask refuses before typing when it could not work', async () => {
  const cases = [
    ['an empty prompt', page(), { prompt: '  ' }, /prompt is empty/],
    ['text already in the box', (() => { const p = page(); p.composer.own = 'a draft'; return p })(), { prompt: 'x' }, /already holds text/],
    ['an answer in progress', (() => { const p = page(); p.stop.shown = true; return p })(), { prompt: 'x' }, /still answering/],
    ['signed out', page({ signedOut: true }), { prompt: 'x' }, /Not signed in/],
    ['no trusted input', page(), { prompt: 'x', ui: null }, /needs chrome-use/],
    ['not enough time to type', page(), { prompt: 'x'.repeat(17000), budgetMs: 120000 }, /does not have the time to type/],
  ]
  for (const [name, p, args, pattern] of cases) {
    const d = drive(p)
    const r = await ask(p, d, args)
    assert.match(r.error, pattern, name)
    assert.deepEqual(d.log.calls.filter((c) => c[0] !== 'click'), [], name + ': nothing typed or pressed')
    assert.deepEqual(d.log.sent, [], name)
  }
})

test('typing that does not land, or an Enter that sends nothing, is "not sent"', async () => {
  let p = page()
  let d = drive(p, { eat: true })
  let r = await ask(p, d, { prompt: 'hello there' })
  assert.equal(r.status, 'not_sent')
  assert.match(r.error, /does not hold the prompt/)
  assert.ok(!d.log.calls.some((c) => c[0] === 'press' && c[1] === 'Enter'), 'Enter is not pressed on a box that lost the prompt')

  p = page()
  d = drive(p, { enterDoes: false })
  r = await ask(p, d, { prompt: 'hello there' })
  assert.equal(r.status, 'not_sent')
  assert.equal(r.sent, false)
  assert.match(r.hint, /still in the Gemini prompt box/)
})

// ---- read / history / detail ----------------------------------------------

test('read returns the turns from the turn elements, without the screen-reader heading or page text', async () => {
  const p = page({ path: '/app/aaaabbbbccccdddd', turns: [['first\nsecond line', 'answer one'], ['next', 'answer two']] })
  const r = await loadAdapter('./read.js', p)({})
  assert.deepEqual(r.turns, [
    { role: 'user', text: 'first\nsecond line' },
    { role: 'assistant', text: 'answer one' },
    { role: 'user', text: 'next' },
    { role: 'assistant', text: 'answer two' },
  ])
  assert.equal(r.conversation_id, 'aaaabbbbccccdddd')
  assert.equal(r.generating, false)
  const last = await loadAdapter('./read.js', p)({ last: 1 })
  assert.deepEqual(last.turns, [{ role: 'assistant', text: 'answer two' }])
  assert.equal(last.total_loaded, 4)
})

test('#904: read on a page with no turns is an error, with the dialog when one is open', async () => {
  const welcome = await loadAdapter('./read.js', page())({})
  assert.match(welcome.error, /No conversation is open/)
  assert.equal(welcome.turns, undefined)
  const blocked = await loadAdapter('./read.js', page({ dialog: { title: '解锁最适合你的 Gemini', buttons: ['继续'] } }))({})
  assert.equal(blocked.status, 'blocked_by_dialog')
  assert.equal(blocked.turns, undefined)
})

test('history lists the side navigation, and says so when it is empty', async () => {
  const r = await loadAdapter('./history.js', page())({ limit: 2 })
  assert.equal(r.count, 2)
  assert.equal(r.loaded, 3)
  assert.deepEqual(r.conversations[0], { title: 'Trip plan', id: 'abc0000000aa', url: 'https://gemini.google.com/app/abc0000000aa' })
  const empty = await loadAdapter('./history.js', page({ titles: [] }))({})
  assert.match(empty.error, /No conversation is listed/)
})

test('detail opens a conversation by id, URL or unique title, and refuses an ambiguous title', async () => {
  // Already there: read it.
  let p = page({ path: '/app/abc0000002aa', turns: [['q', 'a']] })
  let r = await loadAdapter('./detail.js', p)({ conversation: 'Fast Ludo protocol review' })
  assert.deepEqual(r.turns, [{ role: 'user', text: 'q' }, { role: 'assistant', text: 'a' }])
  assert.deepEqual(p.assigned, [])

  // Elsewhere: one navigation, to be rerun.
  for (const named of ['Fast Ludo protocol review', 'fast ludo', 'abc0000002aa', 'https://gemini.google.com/app/abc0000002aa?hl=zh']) {
    p = page()
    const timers = []
    const src = fs.readFileSync(new URL('./detail.js', import.meta.url), 'utf8')
    const run = new Function('window', 'document', 'setTimeout', `${HELPER}\n;return (${src})`)(p.window, p.document, (fn, ms) => (ms < 300 ? setImmediate(fn) : timers.push(fn)))
    r = await run({ conversation: named })
    assert.equal(r.status, 'navigating', named)
    assert.equal(r.url, 'https://gemini.google.com/app/abc0000002aa')
    assert.deepEqual(p.assigned, [], 'after the result is returned')
    timers.forEach((fn) => fn())
    assert.deepEqual(p.assigned, ['https://gemini.google.com/app/abc0000002aa'])
  }

  // "Trip plan" is an exact title; "trip" matches two.
  p = page()
  r = await loadAdapter('./detail.js', p)({ conversation: 'trip' })
  assert.match(r.error, /2 conversations match/)
  assert.equal(r.matches.length, 2)
  assert.deepEqual(p.assigned, [])
  r = await loadAdapter('./detail.js', page())({ conversation: 'no such title' })
  assert.match(r.error, /No conversation in the side navigation matches/)
})

// ---- guards ---------------------------------------------------------------

test('no gemini adapter reads the page text as a whole', () => {
  for (const f of fs.readdirSync(new URL('.', import.meta.url))) {
    if (!f.endsWith('.js') || f.endsWith('.test.js')) continue
    const src = fs.readFileSync(new URL('./' + f, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')
    assert.ok(!/document\.body|documentElement\.(innerText|textContent)|body\.(innerText|textContent)/.test(src), f + ' must read the turn elements only')
  }
})

test('only ask writes, detail alone reruns, and no argument is named after a chrome-use global flag', () => {
  const meta = (f) => JSON.parse(fs.readFileSync(new URL('./' + f, import.meta.url), 'utf8').match(/\/\* @meta\s*([\s\S]*?)\*\//)[1])
  assert.equal(meta('ask.js').readOnly, false)
  assert.equal(meta('ask.js').world, 'isolated')
  // A sent prompt must never be sent again by --until-done.
  assert.equal(meta('ask.js').retryStatuses, undefined)
  for (const f of ['read.js', 'history.js', 'detail.js']) assert.equal(meta(f).readOnly, true, f)
  assert.deepEqual(meta('detail.js').retryStatuses, ['navigating'])
  const reserved = ['new', 'model', 'session', 'profile', 'state', 'timeout', 'url', 'fn', 'json']
  for (const f of ['ask.js', 'read.js', 'history.js', 'detail.js']) {
    for (const name of Object.keys(meta(f).args)) assert.ok(!reserved.includes(name), f + ': --' + name + ' never reaches an adapter')
  }
})
