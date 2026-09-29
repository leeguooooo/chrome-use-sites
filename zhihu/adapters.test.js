import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

// zhihu/article-publish writes to a real account; it is exercised here
// against a stubbed page fetch. The live check is one draft, deleted after.

const TOPICS = {
  claude: [{ id: '27244636', name: 'claude', type: 'topic' }, { id: '1946631524649800689', name: 'claude-code', type: 'topic' }],
  ai编程: [{ id: '2052720954581727052', name: 'ai编程', type: 'topic' }],
  开源: [{ id: '19580349', name: '开源', type: 'topic' }],
  人工智能: [{ id: '19551275', name: '人工智能', type: 'topic' }],
}

/** Zhihu's fetch wrapper: resolves the parsed JSON, rejects with the error body. */
function page({ signedIn = true, publish, calls = [] } = {}) {
  const zfetch = async (url, opts = {}) => {
    const u = new URL(url)
    const body = opts.body ? JSON.parse(opts.body) : undefined
    calls.push({ host: u.host, path: u.pathname, method: opts.method || 'GET', body, opts })
    const route = u.host + ' ' + (opts.method || 'GET') + ' ' + u.pathname
    if (route === 'www.zhihu.com GET /api/v4/me') {
      if (!signedIn) throw { error: { message: '请求需要登录', code: 100 }, status: 401 }
      return { id: 'e697', name: 'Tester' }
    }
    if (route === 'zhuanlan.zhihu.com GET /api/autocomplete/topics') return TOPICS[u.searchParams.get('token').toLowerCase()] || []
    if (route === 'zhuanlan.zhihu.com POST /api/articles/drafts') return { id: 2088455378552074587n.toString() }
    if (/^zhuanlan\.zhihu\.com PATCH \/api\/articles\/\d+\/draft$/.test(route)) return ''
    if (/^zhuanlan\.zhihu\.com POST \/api\/articles\/\d+\/topics$/.test(route)) return body
    if (route === 'www.zhihu.com POST /api/v4/content/publish') {
      if (publish) return publish(body)
      return { publish: { id: '2088455378552074587', url: 'https://zhuanlan.zhihu.com/p/2088455378552074587' } }
    }
    throw { error: { message: 'no route ' + route }, status: 404 }
  }
  const req = (id) => ({ 3343: { Z: zfetch } })[id]
  req.m = { 11: function () {}, 3343: function () { throw Error('Not implemented, please add fetch polyfill.') } }
  return { window: { webpackChunkheifetz: { push: ([, , cb]) => cb(req) } }, calls }
}

function load(env) {
  const src = fs.readFileSync(new URL('./article-publish.js', import.meta.url), 'utf8')
  return new Function('window', `return (${src})`)(env.window)
}

const ARGS = { title: 'T', markdown: '# Top\n\ntext\n\n#### small\n\n```bash\necho "hi"\n```', tags: 'Claude,AI编程,Nope,开源,人工智能' }

test('draft=true: creates, saves the body as Zhihu HTML, binds topics, does not publish', async () => {
  const env = page()
  const r = await load(env)({ ...ARGS, draft: 'true' })
  assert.equal(r.ok, true)
  assert.equal(r.status, 'draft')
  assert.equal(r.id, '2088455378552074587')
  assert.equal(r.url, 'https://zhuanlan.zhihu.com/p/2088455378552074587/edit')
  assert.deepEqual(r.tags, ['claude', 'ai编程', '开源'])
  assert.deepEqual(r.skipped_tags, ['Nope', '人工智能'])
  assert.ok(!env.calls.some((c) => c.path === '/api/v4/content/publish'))
  const create = env.calls.find((c) => c.path === '/api/articles/drafts')
  assert.equal(create.body.content, '<h2>Top</h2><p>text</p><h3>small</h3><pre lang="bash">echo &quot;hi&quot;</pre>')
  assert.equal(create.opts.zsAutoSignature, false)
  const patch = env.calls.find((c) => c.method === 'PATCH')
  assert.equal(patch.body.content, create.body.content)
  assert.equal(env.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/topics')).length, 3)
})

test('publish posts action=article for the draft and returns the /p/ URL', async () => {
  const env = page()
  const r = await load(env)(ARGS)
  assert.equal(r.status, 'published')
  assert.equal(r.url, 'https://zhuanlan.zhihu.com/p/2088455378552074587')
  const pub = env.calls.find((c) => c.path === '/api/v4/content/publish')
  assert.equal(pub.body.action, 'article')
  assert.equal(pub.body.data.draft.id, '2088455378552074587')
  assert.equal(pub.body.data.title.title, 'T')
  assert.equal(pub.body.data.hybrid.html, env.calls.find((c) => c.path === '/api/articles/drafts').body.content)
  assert.equal(JSON.parse(pub.body.data.extra_info.pc_business_params).commentPermission, 'anyone')
})

test('a verification demand (4031) keeps the draft and says so', async () => {
  const env = page({ publish: () => { throw { error: { message: '请先完成手机号绑定', code: 4031 }, status: 403 } } })
  const r = await load(env)(ARGS)
  assert.match(r.error, /请先完成手机号绑定/)
  assert.match(r.hint, /verification/)
  assert.equal(r.status, 'draft')
})

test('publishing with no existing topic is refused before creating anything', async () => {
  const env = page()
  const r = await load(env)({ ...ARGS, tags: 'Nope' })
  assert.match(r.error, /None of the topics/)
  assert.ok(!env.calls.some((c) => c.method !== 'GET'))
})

test('--html overrides the markdown conversion', async () => {
  const env = page()
  await load(env)({ ...ARGS, html: '<p>ready</p>', draft: 'true' })
  assert.equal(env.calls.find((c) => c.path === '/api/articles/drafts').body.content, '<p>ready</p>')
})

test('signed out, or a changed bundle, fails before writing', async () => {
  const env = page({ signedIn: false })
  let r = await load(env)(ARGS)
  assert.match(r.error, /Not signed in/)
  assert.equal(env.calls.length, 1)
  r = await load({ window: {} })(ARGS)
  assert.match(r.error, /fetch client/)
})

test('install.sh ships every zhihu adapter in this repo', () => {
  const install = fs.readFileSync(new URL('../install.sh', import.meta.url), 'utf8')
  const onDisk = fs.readdirSync(new URL('.', import.meta.url)).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
  assert.deepEqual(onDisk.filter((f) => !install.includes('zhihu/' + f)), [])
})
