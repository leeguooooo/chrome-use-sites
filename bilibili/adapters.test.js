import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import test from 'node:test'

// bilibili/user-videos and bilibili/creator-stats read a real signed-in
// account, so they are checked here only, against stubbed api.bilibili.com /
// member.bilibili.com answers. The rows are synthetic, trimmed to the fields
// the adapters read.

// Load an adapter the way chrome-use runs it: the function source evaluated
// in the page, with this page's document and fetch. Timers run at once.
function loadAdapter(file, { fetch, document = fakeDocument() } = {}) {
  const src = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
  const fastTimeout = (fn) => setImmediate(fn)
  return new Function('document', 'fetch', 'setTimeout', 'clearTimeout', `return (${src})`)(document, fetch, fastTimeout, () => {})
}

function fakeDocument() {
  return { createElement: () => ({ getContext: () => null }) }
}

const IMG_KEY = '7cd084941338484aae1ad9425b84077c'
const SUB_KEY = '4932caff0ff746eab6f01bf08b70ac45'
const MIXIN = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52]
const MIXIN_KEY = MIXIN.map((i) => (IMG_KEY + SUB_KEY)[i]).join('').slice(0, 32)

const json = (body, status = 200) => ({ status, ok: status < 400, text: async () => JSON.stringify(body) })
const nav = () => json({ code: 0, data: { mid: 1, wbi_img: { img_url: `https://i0.hdslb.com/bfs/wbi/${IMG_KEY}.png`, sub_url: `https://i0.hdslb.com/bfs/wbi/${SUB_KEY}.png` } } })

function video(i) {
  return { aid: 1000 + i, bvid: 'BV1' + String(i).padStart(9, '0'), title: 'v' + i, play: 100 + i, comment: i, video_review: 2 * i, length: '01:0' + (i % 10), created: 1767225600 + i }
}

// arc/search over `count` videos, pages of `ps`, plus the WBI checks.
function space({ count = 3, risk = 0, like = false, users = [] } = {}) {
  const calls = []
  let riskLeft = risk
  const fetch = async (url) => {
    const u = new URL(url)
    calls.push(u)
    if (u.pathname === '/x/web-interface/nav') return nav()
    const query = u.search.slice(1)
    const unsigned = query.replace(/&w_rid=[0-9a-f]{32}$/, '')
    const wRid = u.searchParams.get('w_rid')
    if (crypto.createHash('md5').update(unsigned + MIXIN_KEY).digest('hex') !== wRid) return json({ code: -403, message: 'bad signature' })
    if (u.pathname === '/x/web-interface/wbi/search/type') return json({ code: 0, data: { result: users } })
    if (riskLeft > 0) { riskLeft -= 1; return json({ code: -352, message: '风控校验失败' }) }
    const ps = Number(u.searchParams.get('ps'))
    const pn = Number(u.searchParams.get('pn'))
    const all = Array.from({ length: count }, (_, i) => ({ ...video(i + 1), ...(like ? { like: 7 } : {}) }))
    return json({ code: 0, data: { list: { vlist: all.slice((pn - 1) * ps, pn * ps) }, page: { pn, ps, count } } })
  }
  return { fetch, calls, arc: () => calls.filter((u) => u.pathname === '/x/space/wbi/arc/search') }
}

test('user-videos signs arc/search with WBI (MD5 matches Node) and keeps OpenCLI\'s fields', async () => {
  const s = space({ count: 3 })
  const out = await loadAdapter('./user-videos.js', { fetch: s.fetch })({ uid: '53579383' })
  assert.equal(out.error, undefined, JSON.stringify(out))
  assert.equal(out.mid, '53579383')
  assert.equal(out.total, 3)
  assert.equal(out.count, 3)
  const v = out.videos[0]
  assert.deepEqual(
    { rank: v.rank, title: v.title, plays: v.plays, date: v.date, url: v.url },
    { rank: 1, title: 'v1', plays: 101, date: '2026-01-01', url: 'https://www.bilibili.com/video/BV1000000001' },
  )
  assert.equal(v.likes, null, 'a count Bilibili leaves out is null, not 0')
  assert.equal(v.comments, 1)
  assert.equal(v.danmaku, 2)
  const q = s.arc()[0].searchParams
  assert.equal(q.get('mid'), '53579383')
  assert.equal(q.get('order'), 'pubdate')
  assert.equal(q.get('ps'), '20')
  assert.equal(q.get('dm_img_list'), '[]')
})

test('user-videos MD5 is right on non-ASCII input too (a 昵称 search)', async () => {
  const s = space({ users: [{ mid: 42, uname: '<em class="keyword">老番茄</em>' }] })
  const out = await loadAdapter('./user-videos.js', { fetch: s.fetch })({ uid: '老番茄', limit: '1' })
  assert.equal(out.mid, '42')
  assert.equal(out.resolved_from, '老番茄')
  assert.equal(out.count, 1)
})

test('user-videos pages past 50 and stops at the end of the list', async () => {
  const s = space({ count: 120, like: true })
  const out = await loadAdapter('./user-videos.js', { fetch: s.fetch })({ uid: '7', limit: '200' })
  assert.equal(out.count, 120)
  assert.equal(out.videos[119].rank, 120)
  assert.equal(out.videos[0].likes, 7)
  assert.deepEqual(s.arc().map((u) => [u.searchParams.get('pn'), u.searchParams.get('ps')]), [['1', '50'], ['2', '50'], ['3', '50']])
})

test('user-videos retries once on risk control (-352) with fresh keys', async () => {
  const s = space({ count: 2, risk: 1 })
  const out = await loadAdapter('./user-videos.js', { fetch: s.fetch })({ uid: '7' })
  assert.equal(out.count, 2)
  assert.equal(s.arc().length, 2)
  assert.equal(s.calls.filter((u) => u.pathname === '/x/web-interface/nav').length, 2)

  const stuck = space({ risk: 5 })
  const err = await loadAdapter('./user-videos.js', { fetch: stuck.fetch })({ uid: '7' })
  assert.match(err.error, /-352/)
  assert.match(err.hint, /风控/)
  assert.equal(stuck.arc().length, 2, 'one retry, not a loop')
})

test('user-videos resolves a name only on an exact match', async () => {
  const users = [{ mid: 1, uname: '老番茄啊' }, { mid: 2, uname: '番茄' }]
  const s = space({ users })
  const out = await loadAdapter('./user-videos.js', { fetch: s.fetch })({ uid: '老番茄' })
  assert.match(out.error, /No user is named exactly/)
  assert.deepEqual(out.candidates.map((c) => c.mid), ['1', '2'])
  assert.equal(s.arc().length, 0)
})

test('user-videos takes a space URL and rejects bad input before any request', async () => {
  const s = space()
  const run = loadAdapter('./user-videos.js', { fetch: s.fetch })
  assert.equal((await run({ uid: 'https://space.bilibili.com/53579383/video' })).mid, '53579383')
  const before = s.calls.length
  assert.match((await run({})).error, /Missing argument: uid/)
  assert.match((await run({ uid: '1', order: 'random' })).error, /Unknown order/)
  assert.match((await run({ uid: 'https://evil.example/53579383' })).error, /Not a space\.bilibili\.com URL/)
  assert.equal(s.calls.length, before)
})

// ---- creator-stats --------------------------------------------------------

const BVID = 'BV1xx411c7mD'
function compareRow(overrides = {}) {
  return {
    bvid: BVID, title: '我的视频', duration: 245,
    stat: {
      play: 12000, like: 800, comment: 40, dm: 55, fav: 120, coin: 90, share: 30, total_new_attention_cnt: 25,
      full_play_ratio: 3150, active_fans_rate: 1200, tm_rate: 640, crash_rate: 2210, interact_rate: 870, play_trans_fan_rate: 21,
    },
    ...overrides,
  }
}
function member({ list, code = 0, view = null }) {
  const calls = []
  const fetch = async (url) => {
    const u = new URL(url)
    calls.push(u.host + u.pathname)
    if (u.pathname === '/x/web/data/archive_diagnose/compare') return json(code === 0 ? { code, data: { list } } : { code, message: '账号未登录' })
    if (u.pathname === '/x/web-interface/view') return json(view || { code: -404, message: '啥都木有' })
    throw new Error('unexpected ' + url)
  }
  return { fetch, calls }
}

test('creator-stats reads the creator-center row, rates as percent', async () => {
  const m = member({ list: [compareRow()] })
  const out = await loadAdapter('./creator-stats.js', { fetch: m.fetch })({ bvid: `https://www.bilibili.com/video/${BVID}/` })
  assert.equal(out.ok, true)
  assert.equal(out.source, 'creator_center')
  assert.equal(out.title, '我的视频')
  assert.equal(out.values.playCount, 12000)
  assert.equal(out.values.durationSeconds, 245)
  assert.equal(out.values.completionPct, 31.5)
  assert.equal(out.values.playToFollowerPct, 0.21)
  assert.equal(out.metrics.length, 15)
  assert.deepEqual(out.metrics[0], { metric: 'playCount', value: 12000, unit: 'count' })
  assert.deepEqual(out.missing, [])
})

test('creator-stats survives a malformed row elsewhere and a metric Bilibili leaves out', async () => {
  const row = compareRow()
  delete row.stat.tm_rate
  const m = member({ list: [null, { bvid: 'not-a-bv' }, row] })
  const out = await loadAdapter('./creator-stats.js', { fetch: m.fetch })({ bvid: BVID })
  assert.equal(out.ok, true)
  assert.equal(out.values.thumbnailClickPct, null)
  assert.deepEqual(out.missing, ['thumbnailClickPct'])
})

test('creator-stats falls back to public counts for a video outside the latest 100', async () => {
  const view = { code: 0, data: { title: '老视频', duration: 61, owner: { mid: 53579383, name: 'me' }, stat: { view: 5, like: 4, reply: 3, danmaku: 2, favorite: 1, coin: 0, share: 9 } } }
  const m = member({ list: [compareRow({ bvid: 'BV1aa411c7mD' })], view })
  const out = await loadAdapter('./creator-stats.js', { fetch: m.fetch })({ bvid: BVID })
  assert.equal(out.source, 'public')
  assert.equal(out.values.playCount, 5)
  assert.equal(out.values.coinCount, 0)
  assert.equal(out.values.newFollowerCount, null)
  assert.equal(out.owner.mid, '53579383')

  const gone = member({ list: [] })
  assert.equal((await loadAdapter('./creator-stats.js', { fetch: gone.fetch })({ bvid: BVID })).error, 'not_found')
})

test('creator-stats: signed out, no analytics yet, and bad ids', async () => {
  const out = await loadAdapter('./creator-stats.js', { fetch: member({ code: -101 }).fetch })({ bvid: BVID })
  assert.equal(out.error, 'not_logged_in')

  const empty = compareRow({ duration: null, stat: Object.fromEntries(Object.keys(compareRow().stat).map((k) => [k, null])) })
  const none = await loadAdapter('./creator-stats.js', { fetch: member({ list: [empty] }).fetch })({ bvid: BVID })
  assert.equal(none.error, 'no_stats_yet')

  const m = member({ list: [] })
  const run = loadAdapter('./creator-stats.js', { fetch: m.fetch })
  assert.match((await run({})).error, /Missing argument: bvid/)
  assert.match((await run({ bvid: 'bv1xx411c7mD' })).error, /Not a BV id/)
  assert.match((await run({ bvid: `http://www.bilibili.com/video/${BVID}` })).error, /Not a BV id/)
  assert.match((await run({ bvid: `https://evil.example/video/${BVID}` })).error, /Not a BV id/)
  assert.deepEqual(m.calls, [])
})

test('install.sh ships every bilibili adapter in this directory', () => {
  const install = fs.readFileSync(new URL('../install.sh', import.meta.url), 'utf8')
  const packs = (install.match(/^PACKS="([^"]*)"/m) || [, ''])[1].split(/\s+/).filter(Boolean)
  const adapters = fs.readdirSync(new URL('.', import.meta.url)).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
  for (const f of adapters) assert.ok(packs.includes(`bilibili/${f}`), `install.sh PACKS is missing bilibili/${f}`)
  for (const p of packs.filter((p) => p.startsWith('bilibili/'))) {
    assert.ok(fs.existsSync(new URL(p.slice('bilibili/'.length), import.meta.url)), `install.sh lists ${p}, which does not exist`)
  }
})
