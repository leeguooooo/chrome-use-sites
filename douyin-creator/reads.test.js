import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

// douyin-creator/me and /works read the signed-in account. They are checked
// here against responses captured from creator.douyin.com on 2026-10-09
// (fixtures/user_info.json, work_list_page*.json, trimmed to the fields the
// adapters read). The one live run of each read the account once.

const fixture = (name) => {
  const d = JSON.parse(fs.readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8'))
  delete d._fixture
  return d
}

function load(file, fetchImpl) {
  const src = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
  const fastTimeout = (fn) => setTimeout(fn, 0)
  return new Function('fetch', 'setTimeout', `return (${src})`)(fetchImpl, fastTimeout)
}

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

test('me maps the creator user info', async () => {
  const me = load('./me.js', async (url) => {
    assert.equal(url, '/web/api/media/user/info/')
    return json(fixture('user_info.json'))
  })
  const out = await me()
  assert.equal(out.nickname, '大果粒科技')
  assert.equal(out.uid, '92485545003')
  assert.equal(out.douyin_id, 'leeguoo')
  assert.equal(out.followers, 1330)
  assert.equal(out.following, 945)
  assert.equal(out.works, 188)
  assert.equal(out.total_likes, 2720)
  assert.match(out.profile_url, /^https:\/\/www\.douyin\.com\/user\/MS4w/)
  assert.ok(!('bind_phone' in out))
})

test('me: signed out is an error with a hint', async () => {
  const me = load('./me.js', async () => json({ status_code: 8, user: null }))
  const out = await me()
  assert.match(out.error, /Not signed in/)
  assert.match(out.hint, /creator\.douyin\.com/)
})

function pager(pages, seen = []) {
  return async (url) => {
    const cursor = new URL(url, 'https://creator.douyin.com').searchParams.get('max_cursor')
    seen.push(cursor)
    const reply = pages[cursor]
    if (reply instanceof Error) throw reply
    if (typeof reply === 'function') return reply()
    if (!reply) throw new Error('unexpected cursor ' + cursor)
    return json(reply)
  }
}

const p0 = fixture('work_list_page0.json')
const p1 = fixture('work_list_page1_private.json')
const last = { ...p1, has_more: false, max_cursor: p1.max_cursor }

test('works pages until has_more is false and marks visibility', async () => {
  const seen = []
  const works = load('./works.js', pager({ 0: p0, [p0.max_cursor]: last }, seen))
  const out = await works({ limit: 100 })
  assert.deepEqual(seen, ['0', String(p0.max_cursor)])
  assert.equal(out.count, p0.aweme_list.length + p1.aweme_list.length)
  assert.equal(out.has_more, false)
  assert.equal(out.next_cursor, null)
  assert.equal(out.total, 202)
  const first = out.works[0]
  assert.equal(first.aweme_id, '7693429129374338319')
  assert.equal(first.visibility, 'public')
  assert.equal(first.plays, 566)
  assert.equal(first.likes, 10)
  assert.equal(first.duration_sec, 113)
  assert.match(first.created_at, /^2026-10-0/)
  assert.equal(first.url, 'https://www.douyin.com/video/7693429129374338319')
  const expected = p1.aweme_list.map((a) => (a.status.is_private ? 'private' : 'public'))
  assert.deepEqual(out.works.slice(p0.aweme_list.length).map((w) => w.visibility), expected)
  assert.ok(expected.includes('private'))
})

test('works: visibility filter and limit', async () => {
  const works = load('./works.js', pager({ 0: p0, [p0.max_cursor]: last }))
  const pub = await works({ visibility: 'public' })
  assert.ok(pub.works.length > 0 && pub.works.every((w) => w.visibility === 'public'))
  const two = await load('./works.js', pager({ 0: p0 }))({ limit: 2 })
  assert.equal(two.count, 2)
  assert.equal(two.has_more, true)
  const bad = await load('./works.js', pager({}))({ visibility: 'friends' })
  assert.match(bad.error, /Bad visibility/)
})

test('works: a dropped request is retried once', async () => {
  let n = 0
  const works = load('./works.js', pager({
    0: () => (n++ === 0 ? Promise.reject(new TypeError('Failed to fetch')) : json({ ...p0, has_more: false })),
  }))
  const out = await works({})
  assert.equal(n, 2)
  assert.equal(out.count, p0.aweme_list.length)
  assert.equal(out.error, undefined)
})

test('works: a page that keeps failing returns what it has and where to resume', async () => {
  const err = new TypeError('Failed to fetch')
  const works = load('./works.js', pager({ 0: p0, [p0.max_cursor]: err }))
  const out = await works({ limit: 100 })
  assert.equal(out.count, p0.aweme_list.length)
  assert.equal(out.has_more, true)
  assert.equal(out.next_cursor, String(p0.max_cursor))
  assert.match(out.error, /Failed to fetch/)
  // Resuming from that cursor asks for exactly that page.
  const seen = []
  await load('./works.js', pager({ [p0.max_cursor]: last }, seen))({ cursor: out.next_cursor })
  assert.deepEqual(seen, [String(p0.max_cursor)])
})
