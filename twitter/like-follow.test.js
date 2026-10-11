import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

// twitter/like and twitter/follow act as the real signed-in account, so they
// are checked here only, against stubbed x.com pages: a conversation with the
// target tweet among other articles, and a profile with "Who to follow"
// suggestions beside the header's own Follow button.

const ID = '1890000000000000001'
const OTHER = '1890000000000000002'

function loadAdapter(file, env) {
  const src = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
  return new Function('window', 'document', 'setTimeout', `return (${src})`)(env.window, env.document, (fn) => setImmediate(fn))
}

function windowAt(url) {
  const location = new URL(url)
  const assigned = []
  location.assign = (u) => assigned.push(u)
  return { window: { location }, assigned }
}

function node(props = {}) {
  return {
    offsetParent: {}, getClientRects: () => [1], attrs: {}, parent: null,
    getAttribute(n) { return this.attrs[n] ?? null },
    closest(sel) {
      for (let n = this; n; n = n.parent) if (n.matches && n.matches(sel)) return n
      return null
    },
    querySelectorAll: () => [],
    ...props,
  }
}

// ---- like -----------------------------------------------------------------

// A conversation page: one <article> per id, each with a status link and a
// heart that flips like -> unlike when clicked (unless `sticky`).
function conversation({ url = `https://x.com/you/status/${ID}`, ids = [OTHER, ID], liked = [], sticky = false } = {}) {
  const log = { clicks: [] }
  const state = Object.fromEntries(ids.map((id) => [id, liked.includes(id)]))
  const arts = ids.map((id) => {
    const art = node({ id, matches: (sel) => sel === 'article' })
    const link = node({ href: `https://x.com/someone/status/${id}`, parent: art })
    const heart = node({
      parent: art,
      attrs: {},
      click() { log.clicks.push('like:' + id); if (!sticky) state[id] = true },
    })
    art.querySelectorAll = (sel) => {
      if (sel === 'a[href*="/status/"]') return [link]
      if (sel === '[data-testid="like"]') return state[id] ? [] : [heart]
      if (sel === '[data-testid="unlike"]') return state[id] ? [heart] : []
      return []
    }
    return art
  })
  const { window, assigned } = windowAt(url)
  const document = { querySelectorAll: (sel) => (sel === 'article' ? arts : []), querySelector: () => null }
  return { env: { window, document }, log, assigned, state }
}

test('like: off the tweet page it opens the tweet and clicks nothing', async () => {
  const page = conversation({ url: 'https://x.com/home' })
  const out = await loadAdapter('./like.js', page.env)({ tweet: `https://x.com/someone/status/${ID}` })
  assert.equal(out.status, 'navigating')
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(page.assigned, [`https://x.com/i/status/${ID}`])
  assert.deepEqual(page.log.clicks, [])
})

test('like: likes the tweet whose own link matches, not the parent above it', async () => {
  const page = conversation()
  const out = await loadAdapter('./like.js', page.env)({ tweet: ID })
  assert.deepEqual(out, { ok: true, status: 'liked', id: ID })
  assert.deepEqual(page.log.clicks, [`like:${ID}`])
  assert.equal(page.state[OTHER], false)
})

test('like: an already-liked tweet is reported and never toggled off', async () => {
  const page = conversation({ liked: [ID] })
  const out = await loadAdapter('./like.js', page.env)({ tweet: `https://twitter.com/someone/status/${ID}/` })
  assert.deepEqual(out, { ok: true, status: 'already_liked', id: ID })
  assert.deepEqual(page.log.clicks, [])
})

test('like: a click that does not turn into Unlike is unconfirmed, clicked once', async () => {
  const page = conversation({ sticky: true })
  const out = await loadAdapter('./like.js', page.env)({ tweet: ID })
  assert.equal(out.error, 'unconfirmed')
  assert.deepEqual(page.log.clicks, [`like:${ID}`])
})

test('like: a tweet missing from its page, and bad input', async () => {
  const page = conversation({ ids: [OTHER] })
  assert.equal((await loadAdapter('./like.js', page.env)({ tweet: ID })).error, 'tweet_not_found')
  const run = loadAdapter('./like.js', page.env)
  assert.match((await run({})).error, /Missing argument: tweet/)
  assert.match((await run({ tweet: 'http://x.com/a/status/1' })).error, /Not an x\.com tweet URL/)
  assert.match((await run({ tweet: 'https://evil.example/a/status/1' })).error, /Not an x\.com tweet URL/)
  assert.deepEqual(page.log.clicks, [])
  assert.deepEqual(page.assigned, [])
})

// ---- follow ---------------------------------------------------------------

// A profile page: the header's button for `handle` (id 111) and a "Who to
// follow" UserCell (id 222) whose Follow button comes first in the DOM.
function profile({ url = 'https://x.com/Target', state = 'follow', protectedAccount = false, sticky = false, label = true, own = false, missing = false } = {}) {
  const log = { clicks: [] }
  const column = node({ matches: (sel) => sel === '[data-testid="primaryColumn"]' })
  const cell = node({ parent: column, matches: (sel) => sel === '[data-testid="UserCell"]' })
  const suggestion = node({
    parent: cell,
    attrs: { 'data-testid': '222-follow', 'aria-label': 'Follow @someone_else' },
    click() { log.clicks.push('suggestion') },
  })
  const header = node({ parent: column, matches: () => false })
  const headerBtn = node({ parent: header, attrs: {} })
  const setState = (s) => {
    headerBtn.attrs['data-testid'] = '111-' + s
    if (label) headerBtn.attrs['aria-label'] = (s === 'follow' ? 'Follow' : s === 'unfollow' ? 'Following' : s === 'cancel' ? 'Pending' : 'Blocked') + ' @target'
  }
  setState(state)
  headerBtn.click = () => {
    log.clicks.push('header:' + headerBtn.attrs['data-testid'])
    if (!sticky) setState(protectedAccount ? 'cancel' : 'unfollow')
  }
  const buttons = () => (own || missing ? [suggestion] : [suggestion, headerBtn])
  column.querySelectorAll = (sel) => buttons().filter((b) => sel.split(',').some((s) => {
    const m = s.match(/^\[data-testid\$="(.+)"\]$/)
    return m && String(b.attrs['data-testid']).endsWith(m[1])
  }))
  const { window, assigned } = windowAt(url)
  const document = {
    querySelector(sel) {
      if (sel === '[data-testid="primaryColumn"]') return column
      if (sel === '[data-testid="editProfileButton"]') return own ? node() : null
      if (sel === '[data-testid="emptyState"]') return missing ? node() : null
      const m = sel.match(/^\[data-testid="(.+)"\]$/)
      return m ? buttons().find((b) => b.attrs['data-testid'] === m[1]) || null : null
    },
    querySelectorAll: () => [],
  }
  return { env: { window, document }, log, assigned }
}

test('follow: off the profile it opens it and clicks nothing', async () => {
  const page = profile({ url: 'https://x.com/home' })
  const out = await loadAdapter('./follow.js', page.env)({ username: '@Target' })
  assert.equal(out.status, 'navigating')
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(page.assigned, ['https://x.com/Target'])
  assert.deepEqual(page.log.clicks, [])
})

test('follow: clicks the header button for the handle, never a "Who to follow" suggestion', async () => {
  const page = profile({ url: 'https://x.com/target/' })
  const out = await loadAdapter('./follow.js', page.env)({ username: 'https://x.com/Target' })
  assert.deepEqual(out, { ok: true, status: 'followed', username: 'Target', user_id: '111' })
  assert.deepEqual(page.log.clicks, ['header:111-follow'])
})

test('follow: without an aria-label it uses the one button outside suggestions', async () => {
  const page = profile({ label: false })
  const out = await loadAdapter('./follow.js', page.env)({ username: 'Target' })
  assert.equal(out.status, 'followed')
  assert.deepEqual(page.log.clicks, ['header:111-follow'])
})

test('follow: already following / request pending are reported and never toggled', async () => {
  for (const [state, status] of [['unfollow', 'already_following'], ['cancel', 'already_requested']]) {
    const page = profile({ state })
    const out = await loadAdapter('./follow.js', page.env)({ username: 'Target' })
    assert.equal(out.status, status)
    assert.deepEqual(page.log.clicks, [])
  }
})

test('follow: a protected account becomes a pending request; an unchanged button is unconfirmed', async () => {
  const req = profile({ protectedAccount: true })
  assert.equal((await loadAdapter('./follow.js', req.env)({ username: 'Target' })).status, 'requested')
  const stuck = profile({ sticky: true })
  const out = await loadAdapter('./follow.js', stuck.env)({ username: 'Target' })
  assert.equal(out.error, 'unconfirmed')
  assert.deepEqual(stuck.log.clicks, ['header:111-follow'])
})

test('follow: blocked, own profile, missing profile, bad handles', async () => {
  const blocked = profile({ state: 'unblock' })
  assert.equal((await loadAdapter('./follow.js', blocked.env)({ username: 'Target' })).error, 'blocked')
  assert.equal((await loadAdapter('./follow.js', profile({ own: true }).env)({ username: 'Target' })).error, 'own_account')
  assert.equal((await loadAdapter('./follow.js', profile({ missing: true }).env)({ username: 'Target' })).error, 'user_not_found')

  const page = profile()
  const run = loadAdapter('./follow.js', page.env)
  assert.match((await run({})).error, /Missing argument: username/)
  assert.match((await run({ username: "x'); alert(1); ('" })).error, /Not an X handle/)
  assert.match((await run({ username: 'home' })).error, /Not an X handle/)
  assert.match((await run({ username: 'https://evil.example/Target' })).error, /Not an x\.com profile URL/)
  assert.match((await run({ username: 'https://x.com/Target/status/1' })).error, /Not an x\.com profile URL/)
  assert.deepEqual(page.log.clicks, [])
  assert.deepEqual(page.assigned, [])
})
