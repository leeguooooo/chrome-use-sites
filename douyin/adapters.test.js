import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

// douyin/delete and douyin/update change a real creator account, so they are
// checked here only: against a stubbed 作品管理 page and stubbed work_list /
// update calls, never against creator.douyin.com (AGENTS.md).
// fixtures/work_list_bigint.json is work_list's shape, trimmed, with
// synthetic ids: item_id is a bare JSON number past 2^53, as Douyin sends it.

const FIXTURE_TEXT = fs.readFileSync(new URL('./fixtures/work_list_bigint.json', import.meta.url), 'utf8')
const TARGET = '7694857245896576275'
const MANAGE = 'https://creator.douyin.com/creator-micro/content/manage'

// Load an adapter the way chrome-use runs it: the function source evaluated
// in the page, with this page's window, document and fetch. Timers run at once.
function load(file, { window, document, fetch }) {
  const src = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
  const fastTimeout = (fn) => setImmediate(fn)
  return new Function('window', 'document', 'fetch', 'setTimeout', `return (${src})`)(window, document, fetch, fastTimeout)
}

// The fixture's works, parsed without losing the ids (the test's own copy).
function works() {
  const quoted = FIXTURE_TEXT.replace(/("item_id":\s*)(\d{16,})/g, '$1"$2"')
  return JSON.parse(quoted)
}

function fakeWindow(url) {
  const assigned = []
  const location = new URL(url)
  location.assign = (u) => assigned.push(u)
  return { window: { location }, assigned }
}

// A 作品管理 page: one card per work (the first `rendered`, the rest after
// scrolling), 删除作品 on each, a confirm dialog, and work_list answering with
// the fixture (split into pages of `pageSize`) until the deleted work is gone.
function managePage({ rendered, cardText = (w) => w.desc.split('\n')[0], pageSize = 20, url = MANAGE } = {}) {
  const fixture = works()
  const all = fixture.aweme_list
  const deleted = []
  const requests = []
  let shown = rendered
  let pendingDelete = null
  const el = (text, extra = {}) => ({
    innerText: text, textContent: text, outerHTML: `<div>${text}</div>`,
    querySelectorAll: () => [], contains: () => false, click() {}, ...extra,
  })
  const cardFor = (w) => {
    const del = el('删除作品', { click() { pendingDelete = w.aweme_id } })
    const buttons = [del, el('继续编辑')]
    return el(`${cardText(w)} 删除作品 继续编辑`, {
      querySelectorAll: () => buttons,
      contains: (o) => buttons.includes(o),
      scrollIntoView() { shown = all.length },
    })
  }
  const cards = all.map(cardFor)
  const confirm = el('确定', {
    click() {
      if (pendingDelete) deleted.push(pendingDelete)
      pendingDelete = null
    },
  })
  const document = {
    querySelectorAll(sel) {
      const live = cards.filter((_, i) => i < shown && !deleted.includes(all[i].aweme_id))
      if (sel === '[class*="video-card"]') return live
      if (sel === 'button,[role="button"]') return pendingDelete ? [confirm] : []
      return [el('全部作品'), ...live.flatMap((c) => c.querySelectorAll())]
    },
  }
  // Served as Douyin sends it: item_id as a bare 19-digit number.
  const fetch = async (u, init) => {
    requests.push({ url: u, init })
    const cursor = Number(new URL(u, 'https://creator.douyin.com').searchParams.get('max_cursor') || 0)
    const live = all.filter((w) => !deleted.includes(w.aweme_id))
    const page = live.slice(cursor, cursor + pageSize)
    const more = cursor + pageSize < live.length
    const body = { ...fixture, aweme_list: page, has_more: more, max_cursor: more ? cursor + pageSize : 0 }
    const text = JSON.stringify(body).replace(/"item_id":"(\d+)"/g, '"item_id":$1')
    return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) }
  }
  const { window, assigned } = fakeWindow(url)
  return { env: { window, document, fetch }, deleted, requests, assigned }
}

test('the fixture really has ids JSON.parse would round', () => {
  const plain = JSON.parse(FIXTURE_TEXT)
  assert.notEqual(String(plain.aweme_list[1].item_id), TARGET)
})

test('delete: off 作品管理 it opens it and asks for a rerun', async () => {
  const page = managePage({ rendered: 3, url: 'https://creator.douyin.com/creator-micro/home' })
  const out = await load('./delete.js', page.env)({ aweme_id: TARGET })
  assert.equal(out.status, 'navigating')
  assert.equal(out.url, MANAGE)
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(page.assigned, [MANAGE])
  assert.deepEqual(page.deleted, [])
  assert.equal(page.requests.length, 0)
})

test('delete: finds the work by title when fewer cards render than work_list lists', async () => {
  // One card at first, the rest after scrolling: a lookup by position needed
  // all three and failed with card_not_found (chrome-use#508).
  const page = managePage({ rendered: 1 })
  const out = await load('./delete.js', page.env)({ aweme_id: TARGET })
  assert.deepEqual(page.deleted, [TARGET])
  assert.equal(out.ok, true)
  assert.equal(out.status, 'deleted')
  assert.equal(out.aweme_id, TARGET)
  assert.equal(out.item_id, TARGET)
  assert.equal(out.error, undefined)
})

test('delete: matches the 19-digit id exactly, not a neighbour that rounds the same', async () => {
  // 7694857245896576001 and ...275 both round to 7694857245896576000.
  const page = managePage({ rendered: 3 })
  await load('./delete.js', page.env)({ aweme_id: '7694857245896576001' })
  assert.deepEqual(page.deleted, ['7694857245896576001'])
})

test('delete: clicks nothing when no card shows the title, and reports exact ids', async () => {
  const page = managePage({ rendered: 3, cardText: () => '别的作品' })
  const out = await load('./delete.js', page.env)({ aweme_id: TARGET })
  assert.equal(out.error, 'card_not_found')
  assert.equal(out.aweme_id, TARGET)
  assert.equal(out.item_id, TARGET)
  assert.equal(out.listCount, 3)
  assert.deepEqual(page.deleted, [])
})

test('delete: pages work_list to find an older work', async () => {
  const page = managePage({ rendered: 3, pageSize: 1 })
  const out = await load('./delete.js', page.env)({ aweme_id: '7694857245896576999' })
  assert.equal(out.status, 'deleted')
  assert.deepEqual(page.deleted, ['7694857245896576999'])
  const cursors = page.requests.map((r) => new URL(r.url, 'https://x').searchParams.get('max_cursor'))
  assert.deepEqual(cursors.slice(0, 3), ['0', '1', '2'])
})

test('delete: an id not in work_list is an error and nothing is clicked', async () => {
  const page = managePage({ rendered: 3 })
  const out = await load('./delete.js', page.env)({ aweme_id: '1234567890123456789' })
  assert.equal(out.error, 'not_found')
  assert.match(out.hint, /nothing was clicked/)
  assert.deepEqual(page.deleted, [])
})

test('delete: rejects a missing or non-numeric id before touching the page', async () => {
  const page = managePage({ rendered: 3 })
  const run = load('./delete.js', page.env)
  assert.match((await run({})).error, /Missing argument: aweme_id/)
  assert.match((await run({ aweme_id: '7694857245896576275x' })).error, /numeric id/)
  assert.equal(page.requests.length, 0)
})

// ---- douyin/update ---------------------------------------------------------

function updateEnv(reply = () => ({ status_code: 0 })) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) })
    const r = reply(url)
    const text = typeof r === 'string' ? r : JSON.stringify(r)
    return { ok: true, status: 200, text: async () => text }
  }
  return { env: { ...fakeWindow('https://creator.douyin.com/'), document: {}, fetch }, calls }
}

test('update: caption posts the id as an exact string', async () => {
  const { env, calls } = updateEnv()
  const out = await load('./update.js', { window: env.window, document: env.document, fetch: env.fetch })({ aweme_id: TARGET, caption: '新的正文 #AI' })
  assert.equal(out.status, 'updated')
  assert.deepEqual(out.updated, ['caption'])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://creator.douyin.com/web/api/media/update/desc/?aid=1128')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.credentials, 'include')
  assert.match(calls[0].init.body, new RegExp(`"aweme_id":"${TARGET}"`))
  assert.equal(calls[0].body.desc, '新的正文 #AI')
})

test('update: reschedule takes ISO 8601 or Unix seconds and checks the 2 h – 14 d window', async () => {
  const { env, calls } = updateEnv()
  const run = load('./update.js', { window: env.window, document: env.document, fetch: env.fetch })
  const inThreeHours = Math.floor(Date.now() / 1000) + 3 * 3600
  const out = await run({ aweme_id: TARGET, reschedule: String(inThreeHours) })
  assert.equal(out.publish_time, inThreeHours)
  assert.equal(calls[0].url, 'https://creator.douyin.com/web/api/media/update/timer/?aid=1128')
  assert.equal(calls[0].body.publish_time, inThreeHours)
  const iso = new Date((inThreeHours + 3600) * 1000).toISOString()
  assert.equal((await run({ aweme_id: TARGET, reschedule: iso })).publish_time, inThreeHours + 3600)
  assert.match((await run({ aweme_id: TARGET, reschedule: String(inThreeHours - 2 * 3600) })).error, /at least 2 hours/)
  assert.match((await run({ aweme_id: TARGET, reschedule: String(inThreeHours + 15 * 86400) })).error, /at most 14 days/)
  assert.match((await run({ aweme_id: TARGET, reschedule: 'next tuesday-ish' })).error, /Bad --reschedule/)
  assert.equal(calls.length, 2)
})

test('update: needs something to change and a numeric id', async () => {
  const { env, calls } = updateEnv()
  const run = load('./update.js', { window: env.window, document: env.document, fetch: env.fetch })
  assert.match((await run({ aweme_id: TARGET })).error, /Nothing to update/)
  assert.match((await run({ caption: 'x' })).error, /Missing argument: aweme_id/)
  assert.match((await run({ aweme_id: '12ab', caption: 'x' })).error, /numeric id/)
  assert.equal(calls.length, 0)
})

test('update: an API error says what already ran, and auth errors ask to sign in', async () => {
  const inThreeHours = Math.floor(Date.now() / 1000) + 3 * 3600
  const { env } = updateEnv((url) => (url.includes('/desc/') ? { status_code: 7, status_msg: '参数错误' } : { status_code: 0, aweme_id: 7694857245896576275n.toString() }))
  const out = await load('./update.js', { window: env.window, document: env.document, fetch: env.fetch })({ aweme_id: TARGET, reschedule: String(inThreeHours), caption: 'x' })
  assert.match(out.error, /Douyin API error 7/)
  assert.deepEqual(out.updated, ['reschedule'])
  assert.match(out.hint, /Already updated: reschedule/)

  const signedOut = updateEnv(() => ({ status_code: 8, status_msg: '用户未登录' }))
  const out2 = await load('./update.js', { window: signedOut.env.window, document: {}, fetch: signedOut.env.fetch })({ aweme_id: TARGET, caption: 'x' })
  assert.match(out2.hint, /sign in/)
})
