import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

// twitter/delete deletes a real tweet, so it is checked here only, against a
// stubbed tweet page: the target <article> (and a quoted tweet beside it),
// its ⋯ menu, the menu items and the confirmation sheet.

const SRC = fs.readFileSync(new URL('./delete.js', import.meta.url), 'utf8')
const ID = '1890000000000000001'
const OTHER = '1890000000000000002'

function load(env) {
  return new Function('window', 'document', 'setTimeout', `return (${SRC})`)(env.window, env.document, (fn) => setImmediate(fn))
}

function tweetPage({ url = `https://x.com/you/status/${ID}`, own = true, articles = [ID, OTHER], lang = 'en' } = {}) {
  const log = { clicks: [] }
  let menuOpen = false
  let sheet = false
  const node = (props) => ({
    offsetParent: {}, getClientRects: () => [1], textContent: '', attrs: {},
    getAttribute(n) { return this.attrs[n] ?? null }, querySelectorAll: () => [], ...props,
  })
  const arts = articles.map((id) => {
    const art = node({ id })
    const link = node({ href: `https://x.com/someone/status/${id}`, closest: () => art })
    const caret = node({ attrs: { 'data-testid': 'caret' }, closest: () => art, click() { log.clicks.push('more:' + id); menuOpen = id } })
    art.querySelectorAll = (sel) => (sel === 'a[href*="/status/"]' ? [link] : sel === '[data-testid="caret"]' ? [caret] : [])
    return art
  })
  const items = () => {
    if (!menuOpen) return []
    const rows = [node({ textContent: lang === 'zh' ? '从列表添加/删除 @you' : 'Add/remove @you from Lists', click() { log.clicks.push('lists') } })]
    if (own) rows.push(node({ textContent: lang === 'zh' ? '删除' : 'Delete', click() { log.clicks.push('delete:' + menuOpen); sheet = true } }))
    return rows
  }
  const confirm = node({ click() { log.clicks.push('confirm'); log.deleted = menuOpen } })
  const document = {
    querySelectorAll: (sel) => (sel === 'article' ? arts : sel === '[role="menuitem"]' ? items() : []),
    querySelector: (sel) => (sel === '[data-testid="confirmationSheetConfirm"]' && sheet ? confirm : null),
  }
  const location = new URL(url)
  const assigned = []
  location.assign = (u) => assigned.push(u)
  return { env: { window: { location }, document }, log, assigned }
}

test('off the tweet page it opens the tweet and asks for a rerun', async () => {
  const page = tweetPage({ url: 'https://x.com/home' })
  const out = await load(page.env)({ tweet: `https://x.com/you/status/${ID}` })
  assert.equal(out.status, 'navigating')
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(page.assigned, [`https://x.com/i/status/${ID}`])
  assert.deepEqual(page.log.clicks, [])
})

test('deletes the tweet whose own link matches, not a quoted one beside it', async () => {
  const page = tweetPage({ articles: [OTHER, ID] })
  const out = await load(page.env)({ tweet: ID })
  assert.deepEqual(out, { ok: true, status: 'deleted', id: ID })
  assert.deepEqual(page.log.clicks, [`more:${ID}`, `delete:${ID}`, 'confirm'])
})

test('works with the Chinese UI and skips the Lists row', async () => {
  const page = tweetPage({ lang: 'zh' })
  const out = await load(page.env)({ tweet: `https://twitter.com/you/status/${ID}/` })
  assert.equal(out.status, 'deleted')
  assert.ok(!page.log.clicks.includes('lists'))
})

test('someone else\'s tweet has no Delete: error, nothing confirmed', async () => {
  const page = tweetPage({ own: false })
  const out = await load(page.env)({ tweet: ID })
  assert.equal(out.error, 'not_own_tweet')
  assert.ok(!page.log.clicks.includes('confirm'))
})

test('bad input is rejected before anything is clicked or opened', async () => {
  const page = tweetPage()
  const run = load(page.env)
  assert.match((await run({})).error, /Missing argument: tweet/)
  assert.match((await run({ tweet: 'http://x.com/you/status/1' })).error, /Not an x\.com tweet URL/)
  assert.match((await run({ tweet: 'https://evil.example/you/status/1' })).error, /Not an x\.com tweet URL/)
  assert.match((await run({ tweet: 'https://x.com/you' })).error, /No tweet id/)
  assert.deepEqual(page.log.clicks, [])
  assert.deepEqual(page.assigned, [])
})
