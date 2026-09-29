import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

// These adapters write to a real account, so they are only ever exercised
// here, against a stubbed api.juejin.cn. The one live check is one draft,
// deleted straight after.

/** A fake api.juejin.cn: `routes[path](body)` answers, every call is recorded. */
function juejin(routes = {}) {
  const calls = []
  const fetch = async (url, opts = {}) => {
    const u = new URL(url)
    const body = opts.body ? JSON.parse(opts.body) : null
    calls.push({ path: u.pathname, method: opts.method || 'GET', body, credentials: opts.credentials })
    const route = routes[u.pathname]
    const data = typeof route === 'function' ? route(body) : route
    if (data === undefined) return { ok: true, status: 200, json: async () => ({ err_no: 2, err_msg: '请求路由不存在' }) }
    return { ok: true, status: 200, json: async () => ({ err_no: 0, err_msg: 'success', data }) }
  }
  return { fetch, calls }
}

const SIGNED_IN = {
  '/user_api/v1/user/get': { user_id: '42', user_name: 'Tester' },
  '/tag_api/v1/query_category_list': [
    { category_id: '6809637773935378440', category: { category_name: '人工智能' } },
    { category_id: '6809637767543259144', category: { category_name: '前端' } },
  ],
  '/tag_api/v1/query_tag_list': (b) =>
    ({
      claude: [{ tag_id: '7248530085798985765', tag: { tag_name: 'Claude' } }],
      开源: [{ tag_id: '6809640419505209000', tag: { tag_name: '开源' } }, { tag_id: '1', tag: { tag_name: '开源项目' } }],
      nope: [{ tag_id: '9', tag: { tag_name: 'nopenope' } }],
    })[b.key_word.toLowerCase()] || [],
  '/content_api/v1/article_draft/create': { id: '7690000000000000001' },
  '/content_api/v1/article/publish': { article_id: '7690000000000000999' },
}

function load(env) {
  const src = fs.readFileSync(new URL('./article-publish.js', import.meta.url), 'utf8')
  return new Function('fetch', `return (${src})`)(env.fetch)
}

const ARGS = { title: 'T', markdown: '# Hi\n\nbody text', summary: 'S', tags: 'Claude,开源,nope', category: '人工智能' }

test('draft=true creates the draft and never publishes', async () => {
  const env = juejin(SIGNED_IN)
  const r = await load(env)({ ...ARGS, draft: 'true' })
  assert.equal(r.ok, true)
  assert.equal(r.status, 'draft')
  assert.equal(r.id, '7690000000000000001')
  assert.equal(r.url, 'https://juejin.cn/editor/drafts/7690000000000000001')
  assert.ok(!env.calls.some((c) => c.path === '/content_api/v1/article/publish'))
  const create = env.calls.find((c) => c.path === '/content_api/v1/article_draft/create')
  assert.equal(create.body.mark_content, ARGS.markdown)
  assert.equal(create.body.edit_type, 10)
  assert.equal(create.body.category_id, '6809637773935378440')
  assert.equal(create.body.brief_content, 'S')
  assert.equal(create.credentials, 'include')
})

test('publish sends the draft id and returns the post URL', async () => {
  const env = juejin(SIGNED_IN)
  const r = await load(env)(ARGS)
  assert.equal(r.status, 'published')
  assert.equal(r.id, '7690000000000000999')
  assert.equal(r.url, 'https://juejin.cn/post/7690000000000000999')
  const pub = env.calls.find((c) => c.path === '/content_api/v1/article/publish')
  assert.equal(pub.body.draft_id, '7690000000000000001')
})

test('tags: exact matches only; a near miss is skipped, not substituted', async () => {
  const env = juejin(SIGNED_IN)
  const r = await load(env)({ ...ARGS, draft: 'true' })
  assert.deepEqual(r.tags, ['Claude', '开源'])
  assert.deepEqual(r.skipped_tags, ['nope'])
  const create = env.calls.find((c) => c.path === '/content_api/v1/article_draft/create')
  assert.deepEqual(create.body.tag_ids, ['7248530085798985765', '6809640419505209000'])
})

test('publishing without a category or any real tag is refused before writing', async () => {
  let env = juejin(SIGNED_IN)
  let r = await load(env)({ ...ARGS, category: '' })
  assert.match(r.error, /category/)
  assert.ok(!env.calls.some((c) => c.path.startsWith('/content_api')))

  env = juejin(SIGNED_IN)
  r = await load(env)({ ...ARGS, tags: 'nope' })
  assert.match(r.error, /None of the tags/)
  assert.ok(!env.calls.some((c) => c.path.startsWith('/content_api')))

  env = juejin(SIGNED_IN)
  r = await load(env)({ ...ARGS, category: '不存在' })
  assert.match(r.error, /Unknown Juejin category/)
  assert.match(r.hint, /人工智能/)
})

test('a failed publish reports the saved draft and says not to re-run', async () => {
  const env = juejin({ ...SIGNED_IN, '/content_api/v1/article/publish': undefined })
  const r = await load(env)(ARGS)
  assert.match(r.error, /publish failed/)
  assert.equal(r.status, 'draft')
  assert.equal(r.draft_id, '7690000000000000001')
  assert.match(r.hint, /Do not re-run/)
})

test('signed out: stops before any write', async () => {
  const env = juejin({})
  const r = await load(env)(ARGS)
  assert.match(r.error, /Not signed in/)
  assert.equal(env.calls.length, 1)
})

test('summary defaults to the first 100 characters of the body text', async () => {
  const env = juejin(SIGNED_IN)
  const long = '# 标题\n\n' + '字'.repeat(300) + '\n\n```js\ncode()\n```'
  await load(env)({ ...ARGS, summary: '', markdown: long, draft: 'true' })
  const create = env.calls.find((c) => c.path === '/content_api/v1/article_draft/create')
  assert.equal(Array.from(create.body.brief_content).length, 100)
  assert.ok(!create.body.brief_content.includes('#'))
})

test('missing title or body', async () => {
  const env = juejin(SIGNED_IN)
  assert.match((await load(env)({ markdown: 'x' })).error, /title/)
  assert.match((await load(env)({ title: 'x' })).error, /markdown/)
  assert.equal(env.calls.length, 0)
})

test('install.sh ships every juejin adapter in this directory', () => {
  const install = fs.readFileSync(new URL('../install.sh', import.meta.url), 'utf8')
  const onDisk = fs.readdirSync(new URL('.', import.meta.url)).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
  assert.deepEqual(onDisk.filter((f) => !install.includes('juejin/' + f)), [])
})
