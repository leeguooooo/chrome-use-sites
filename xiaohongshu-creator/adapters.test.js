import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const HELPER = fs.readFileSync(new URL('./_helper.js', import.meta.url), 'utf8')
const fixture = (name) => {
  const d = JSON.parse(fs.readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8'))
  delete d._fixture
  return d
}

// A clock that jumps a second per read, so the helper's bounded wait for the
// app to boot gives up at once instead of spinning for ten real seconds.
const fastClock = () => {
  let t = 0
  return { now: () => (t += 1000) }
}

/** A creator page: Vuex user, webpack registry, and the signed HTTP client. */
function page({ routes = {}, user = { userId: 'u-1', userName: 'Creator', redId: '000' }, seen = [], bundle = true } = {}) {
  const client = {
    interceptors: {},
    post: async () => {
      throw new Error('adapters are read-only; nothing should POST')
    },
    get: async (path, opts) => {
      // Like the real client, write the URL into the caller's config and read
      // it back after a tick. Shared configs then collide, as they did live.
      opts.url = path
      await Promise.resolve()
      path = opts.url
      seen.push({ path, opts })
      const reply = routes[path]
      if (reply === undefined) throw Object.assign(new Error('HTTP 404'), { status: 404 })
      return typeof reply === 'function' ? reply(opts) : reply
    },
  }
  // Shaped like the real bundle: a consumer module imports the client module
  // and calls it with an endpoint key. The export name is minified (LV).
  const modules = {
    11237: { LV: client },
    56462: {},
  }
  const req = (id) => modules[id]
  req.m = {
    100: new Function('e', 't', 'n', 'var x=n(9);function z(){return x.y}'),
    56462: new Function('e', 't', 'n', 'var a=n(11237);function E(e){return a.LV.get("NOTE_STATICS",{params:e,transform:!0})}'),
  }
  const window = bundle ? { webpackChunkugc: { push: ([, , cb]) => cb(req) } } : {}
  const document = {
    querySelector: (sel) =>
      sel === '#app' && user
        ? { __vue_app__: { config: { globalProperties: { $store: { state: { Auth: { userInfo: user } } } } } } }
        : null,
  }
  return { window, document, client }
}

// Mirror how chrome-use runs these: the family `_helper.js` is defined in an
// enclosing scope the adapter expression closes over.
function loadAdapter(filename, env) {
  const source = fs.readFileSync(new URL(filename, import.meta.url), 'utf8')
  return new Function('window', 'document', 'Date', 'setTimeout', 'clearTimeout', `${HELPER}\n;return (${source})`)(
    env.window,
    env.document,
    env.clock || Date,
    env.setTimeout || setTimeout,
    clearTimeout,
  )
}

const PERSONAL = '/api/galaxy/creator/home/personal_info'
const ACCOUNT = '/api/galaxy/v2/creator/datacenter/account/base'
const POSTED = '/api/galaxy/v2/creator/note/user/posted'
const NOTE_BASE = '/api/galaxy/creator/datacenter/note/base'
const SOURCE = '/api/galaxy/creator/datacenter/note/audience/source'
const DETAIL = '/api/galaxy/creator/datacenter/note/audience/source/detail'

// ---- helper ---------------------------------------------------------------

test('the client is found through the endpoint key, not a hard-coded export name', async () => {
  const env = page({ routes: { [PERSONAL]: fixture('personal_info.json') } })
  const r = await loadAdapter('./me.js', env)({ summary: 'false' })
  assert.equal(r.nickname, '测试创作者')
})

test('signed out: refuses before calling any endpoint', async () => {
  const seen = []
  const env = page({ user: null, seen, routes: { [PERSONAL]: {} } })
  const r = await loadAdapter('./me.js', { ...env, clock: fastClock() })({})
  assert.match(r.error, /Not signed in/)
  assert.equal(seen.length, 0)
})

test('a changed bundle says so instead of throwing', async () => {
  const env = page({ bundle: false })
  const r = await loadAdapter('./notes.js', { ...env, clock: fastClock() })({})
  assert.match(r.error, /HTTP client/)
  assert.match(r.hint, /changed its bundle/)
})

test('no adapter signs or fetches on its own', () => {
  // The whole point of routing through the page client: it adds X-s / X-t /
  // X-S-Common itself. A hand-rolled fetch would go out unsigned (or with a
  // reimplemented signature), which is exactly the traffic that gets flagged.
  for (const f of fs.readdirSync(new URL('.', import.meta.url))) {
    if (!f.endsWith('.js') || f.endsWith('.test.js')) continue
    const src = fs.readFileSync(new URL('./' + f, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')
    assert.ok(!/\bfetch\(|XMLHttpRequest|_webmsxyw\(|['"]x-s['"]/i.test(src), f + ' must not fetch or sign directly')
  }
})

// ---- me -------------------------------------------------------------------

test('me reports profile counts and both data-center periods', async () => {
  const seen = []
  const env = page({
    seen,
    routes: { [PERSONAL]: fixture('personal_info.json'), [ACCOUNT]: fixture('account_base.json') },
  })
  const r = await loadAdapter('./me.js', env)({})
  assert.equal(r.user_id, 'u-1') // from the Vuex store, not a request
  assert.equal(r.red_id, '000000000')
  assert.equal(r.fans, 130)
  assert.equal(r.follows, 121)
  assert.equal(r.likes_and_collects, 1097)
  assert.equal(r.data_center.last_7_days.start, '2026-09-22')
  assert.equal(r.data_center.last_7_days.end, '2026-09-28')
  assert.equal(r.data_center.last_7_days.home_views, 4)
  assert.ok(r.data_center.last_30_days)
  assert.deepEqual(seen.map((s) => s.path), [PERSONAL, ACCOUNT])
  assert.ok(!('phone' in r), 'the store holds a phone number; it must not leak')
})

test('me --summary false makes exactly one request', async () => {
  const seen = []
  const env = page({ seen, routes: { [PERSONAL]: fixture('personal_info.json') } })
  const r = await loadAdapter('./me.js', env)({ summary: 'false' })
  assert.equal(r.data_center, null)
  assert.equal(seen.length, 1)
})

test('me keeps the profile when only the summary fails', async () => {
  const env = page({ routes: { [PERSONAL]: fixture('personal_info.json') } })
  const r = await loadAdapter('./me.js', env)({})
  assert.equal(r.fans, 130)
  assert.match(r.data_center.error, /account\/base/)
})

// ---- notes ----------------------------------------------------------------

const VIDEO_NOTE = {
  id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  display_title: 'video',
  type: 'video',
  tab_status: 2,
  permission_code: 1,
  permission_msg: '',
  time: '2026-09-01 09:05',
  video_info: { duration: 42 },
  images_list: [],
  xsec_token: 'tok',
  xsec_source: 'pc_creatormng',
  view_count: 0,
  likes: 0,
}

test('notes maps status, visibility, url and metrics', async () => {
  const p0 = fixture('posted_page0.json')
  const env = page({ routes: { [POSTED]: { ...p0, page: -1, notes: [...p0.notes, VIDEO_NOTE] } } })
  const r = await loadAdapter('./notes.js', env)({})
  assert.equal(r.total, 42)
  assert.equal(r.next_page, null)
  const [first] = r.notes
  assert.equal(first.id, '698eff2a000000000a03dced')
  assert.equal(first.status, 'published')
  assert.equal(first.status_text, '已发布')
  assert.equal(first.status_code, 1)
  assert.equal(first.visibility, 'public')
  assert.equal(first.published_at, '2026-02-13T18:38:00+08:00')
  assert.equal(first.pinned, true)
  assert.equal(first.views, 6)
  assert.equal(first.likes, 1)
  assert.equal(first.shares, 3)
  assert.equal(
    first.url,
    'https://www.xiaohongshu.com/explore/698eff2a000000000a03dced?xsec_token=XSEC_TOKEN_REDACTED&xsec_source=pc_creatormng',
  )
  const v = r.notes.at(-1)
  assert.equal(v.type, 'video')
  assert.equal(v.status, 'reviewing')
  assert.equal(v.status_text, '审核中')
  assert.equal(v.visibility, 'private')
  assert.equal(v.visibility_text, '仅自己可见')
  assert.equal(v.video_duration, 42)
  // Omitted by XHS → null, not 0.
  assert.equal(v.collects, null)
  assert.equal(v.comments, null)
  assert.equal(v.shares, null)
})

test('notes pages by 10 and stops at limit, the last page, or an empty page', async () => {
  const ten = (p) => Array.from({ length: 10 }, (_, i) => ({ ...VIDEO_NOTE, id: String(p) + i }))
  const seen = []
  const env = page({
    seen,
    routes: { [POSTED]: (opts) => ({ page: opts.params.page + 1, tags: [{ notes_count: 99 }], notes: ten(opts.params.page) }) },
  })
  const adapter = loadAdapter('./notes.js', env)

  let r = await adapter({})
  assert.equal(r.count, 20)
  assert.equal(r.next_page, 2)
  assert.deepEqual(seen.map((s) => s.opts.params.page), [0, 1])

  seen.length = 0
  r = await adapter({ limit: '500', page: '3' })
  assert.equal(seen.length, 5, 'limit clamps to 50 = 5 pages')
  assert.equal(r.page, 3)

  // A cut page is resumed, not skipped.
  seen.length = 0
  r = await adapter({ limit: '15' })
  assert.equal(r.count, 15)
  assert.equal(r.next_page, 1)
})

test('notes --tab accepts names and Chinese labels, rejects junk', async () => {
  const seen = []
  const env = page({ seen, routes: { [POSTED]: { page: -1, tags: [], notes: [] } } })
  const adapter = loadAdapter('./notes.js', env)
  for (const [tab, id] of [['rejected', 3], ['审核中', 2], ['scheduled', 4], [undefined, 0]]) {
    seen.length = 0
    const r = await adapter({ tab })
    assert.equal(seen[0].opts.params.tab, id)
    // Not '0': integer-like keys sort first in a JS object, so a reverse
    // lookup over the alias table returns the numeric alias.
    assert.equal(r.tab, ['all', 'published', 'reviewing', 'rejected', 'scheduled'][id])
    assert.equal(r.next_page, null)
  }
  const bad = await adapter({ tab: 'drafts' })
  assert.match(bad.error, /Unknown tab/)
})

test('a captcha/throttle status tells the caller to stop', async () => {
  const env = page({
    routes: {
      [POSTED]: () => {
        throw Object.assign(new Error('blocked'), { status: 461 })
      },
    },
  })
  const r = await loadAdapter('./notes.js', env)({})
  assert.equal(r.status, 461)
  assert.match(r.hint, /do not retry/)
})

test('a request that outlives the relay budget returns a clean error', async () => {
  // chrome-use abandons an evaluation after ~8 s; personal_info has been seen
  // taking 10 s. The adapter has to answer first. Timers fire at once here.
  const env = page({ routes: { [PERSONAL]: () => new Promise(() => {}) } })
  const r = await loadAdapter('./me.js', { ...env, setTimeout: (fn) => (queueMicrotask(fn), 0) })({})
  assert.match(r.error, /did not answer/)
  assert.match(r.hint, /do not loop/)
})

test('notes returns the pages it got when time runs out, with a resumable cursor', async () => {
  let t = 0
  const seen = []
  const env = page({
    seen,
    routes: {
      [POSTED]: (opts) => {
        t += 6900 // the first page eats almost the whole budget
        return { page: opts.params.page + 1, tags: [{ notes_count: 42 }], notes: [{ ...VIDEO_NOTE, id: 'p' + opts.params.page }] }
      },
    },
  })
  const r = await loadAdapter('./notes.js', { ...env, clock: { now: () => t } })({ limit: '30' })
  assert.equal(seen.length, 1, 'the second page is not even sent')
  assert.equal(r.count, 1)
  assert.equal(r.next_page, 1)
  assert.match(r.partial, /in time/)
})

test('a -101 body is reported as a lost session', async () => {
  const env = page({
    routes: {
      [NOTE_BASE]: () => {
        throw Object.assign(new Error('x'), { status: 200, data: { code: -101 } })
      },
    },
  })
  const r = await loadAdapter('./note-stats.js', env)({ note_id: '6abbe0ef000000001203e9c7' })
  assert.equal(r.status, 401)
})

// ---- note-stats -----------------------------------------------------------

test('note-stats accepts an explore URL and keeps -1 as null', async () => {
  const seen = []
  const env = page({
    seen,
    routes: {
      [NOTE_BASE]: fixture('note_base_fresh.json'),
      [SOURCE]: fixture('audience_source_nodata.json'),
      [DETAIL]: fixture('audience_detail_nodata.json'),
    },
  })
  const r = await loadAdapter('./note-stats.js', env)({
    note_id: 'https://www.xiaohongshu.com/explore/6abbe0ef000000001203e9c7?xsec_token=abc&xsec_source=pc_feed',
  })
  assert.equal(r.note_id, '6abbe0ef000000001203e9c7')
  assert.equal(seen[0].opts.params.note_id, '6abbe0ef000000001203e9c7')
  // Three different endpoints, not the last one three times.
  assert.deepEqual(seen.map((s) => s.path).sort(), [NOTE_BASE, SOURCE, DETAIL].sort())
  assert.equal(r.type, 'normal')
  assert.equal(r.metrics.views, 19)
  assert.equal(r.metrics.likes, 0) // a real zero stays zero
  assert.equal(r.metrics.impressions, null) // -1: not computed yet
  assert.equal(r.metrics.avg_view_time_sec, null)
  assert.equal(r.metrics.follows_gained, null)
  assert.equal(r.days_since_post, null)
  assert.equal(r.traffic_sources.available, false)
  assert.equal(r.traffic_sources.reason, '数据统计中，请稍后查看')
  assert.equal(r.audience.available, false)
})

test('note-stats reports an image note, with video-only rates null', async () => {
  const env = page({
    routes: {
      [NOTE_BASE]: fixture('note_base_image.json'),
      [SOURCE]: {
        source: [
          { title: '首页推荐', value: 62, valueWithDouble: 62.4 },
          { title: '搜索', value: 20, valueWithDouble: 20.1 },
        ],
      },
      [DETAIL]: { gender: [{ title: '女', value: 55 }], age: [], city: [], interest: [] },
    },
  })
  const r = await loadAdapter('./note-stats.js', env)({ note_id: '69918bba000000000e03d6c0' })
  assert.equal(r.metrics.views, 267)
  assert.equal(r.metrics.impressions, 1653)
  assert.equal(r.metrics.cover_click_rate_pct, 15.3)
  assert.equal(r.metrics.avg_view_time_sec, 12)
  assert.equal(r.metrics.comments, 2)
  assert.equal(r.days_since_post, 226)
  assert.equal(r.metrics.full_view_rate_pct, null) // 0 on image notes means n/a
  assert.equal(r.metrics.avg_images_viewed, 0)
  assert.equal(r.published_at, '2026-02-15T17:02:50+08:00')
  assert.deepEqual(r.traffic_sources.sources, [
    { name: '首页推荐', pct: 62.4 },
    { name: '搜索', pct: 20.1 },
  ])
  assert.deepEqual(r.audience.gender, [{ name: '女', pct: 55 }])
})

test('note-stats --audience false makes one request; bad ids make none', async () => {
  const seen = []
  const env = page({ seen, routes: { [NOTE_BASE]: fixture('note_base_image.json') } })
  const adapter = loadAdapter('./note-stats.js', env)
  const r = await adapter({ note_id: '69918bba000000000e03d6c0', audience: 'false' })
  assert.equal(r.traffic_sources, null)
  assert.equal(seen.length, 1)

  seen.length = 0
  for (const note_id of [undefined, '', 'not-a-note', 'https://www.xiaohongshu.com/user/profile/x']) {
    assert.match((await adapter({ note_id })).error, /note_id/)
  }
  assert.equal(seen.length, 0)
})

test('note-stats on a note that is not yours says so', async () => {
  const env = page({ routes: { [NOTE_BASE]: { result: { success: true }, noteInfo: {} } } })
  const r = await loadAdapter('./note-stats.js', env)({ note_id: 'bbbbbbbbbbbbbbbbbbbbbbbb' })
  assert.match(r.hint, /signed-in account/)
})

// ---- packaging --------------------------------------------------------------

test('install.sh ships every xiaohongshu-creator adapter in this directory', () => {
  const install = fs.readFileSync(new URL('../install.sh', import.meta.url), 'utf8')
  const onDisk = fs
    .readdirSync(new URL('.', import.meta.url))
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
  const missing = onDisk.filter((f) => !install.includes('xiaohongshu-creator/' + f))
  assert.deepEqual(missing, [], 'these adapters exist but install.sh will not fetch them: ' + missing.join(', '))
  const listed = [...install.matchAll(/xiaohongshu-creator\/([\w.-]+\.js)/g)].map((m) => m[1])
  const stale = listed.filter((f) => !onDisk.includes(f))
  assert.deepEqual(stale, [], 'install.sh lists files that do not exist: ' + stale.join(', '))
})
