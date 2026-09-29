import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

// segmentfault/article-publish writes to a real account; it is exercised here
// against a stubbed page API. The live check is one draft, deleted after.

// Shaped like the real _app module: an Api instance D whose bound methods are
// pulled into locals, and a webpack export map that renames them.
const API_SRC = [
  'C.d(_,{DOp:function(){return ec},fDS:function(){return ed},PRA:function(){return ef},NJe:function(){return ex},XDd:function(){return eu}});',
  'let Api=class Api{saveDraft(m){return this.request.send("/draft",{method:"POST",data:m})}};',
  'let D=new Api;let ec=D.saveDraft,eu=D.updateDraft,ed=D.postArticle,ef=D.getUser,ex=D.getTags;',
].join('')

const TAGS = {
  claude: [{ id: 1040000044137481, name: 'claude' }, { id: 1040000046912484, name: 'claude-code' }],
  codex: [{ id: 1040000047678391, name: 'codex' }],
  人工智能: [{ id: 1040000000089791, name: '人工智能' }],
  开源: [{ id: 1040000000126528, name: '开源' }, { id: 1040000000414117, name: '开源项目介绍' }],
}

function page({ user = { user: { id: 1, slug: 'me' } }, post, calls = [] } = {}) {
  const mod = {
    DOp: async (m) => { calls.push(['saveDraft', m]); return { id: 1220000048325812 } },
    fDS: post || (async (m) => { calls.push(['postArticle', m]); return { data: { id: 1190000047000001 }, msg: '' } }),
    PRA: async () => { if (!user) throw false; return user },
    NJe: async ({ q }) => ({ rows: TAGS[q.toLowerCase()] || [] }),
    XDd: async () => ({}),
  }
  const req = (id) => ({ 3014: mod })[id]
  req.m = { 7: function () {}, 3014: new Function('m', '_', 'C', API_SRC) }
  const window = {
    webpackChunk_N_E: { push: ([, , cb]) => cb(req) },
    __NEXT_DATA__: { props: { pageProps: { initialState: { global: { sessionInfo: { login: !!user } } } } } },
  }
  return { window, calls }
}

function load(env) {
  const src = fs.readFileSync(new URL('./article-publish.js', import.meta.url), 'utf8')
  return new Function('window', `return (${src})`)(env.window)
}

const ARGS = { title: 'T', markdown: '# md body', tags: 'Claude,Codex,AI编程,人工智能,开源' }

test('draft=true saves a draft with the Markdown and exact-match tag ids, and does not publish', async () => {
  const env = page()
  const r = await load(env)({ ...ARGS, draft: 'true' })
  assert.equal(r.ok, true)
  assert.equal(r.status, 'draft')
  assert.equal(r.id, '1220000048325812')
  assert.deepEqual(r.tags, ['claude', 'codex', '人工智能', '开源'])
  assert.deepEqual(r.skipped_tags, ['AI编程'])
  assert.equal(env.calls.length, 1)
  const [name, body] = env.calls[0]
  assert.equal(name, 'saveDraft')
  assert.equal(body.text, '# md body')
  assert.equal(body.type, 'article')
  assert.deepEqual(body.tags, [1040000044137481, 1040000047678391, 1040000000089791, 1040000000126528])
})

test('publish posts the draft as 原创 and returns /a/<id>', async () => {
  const env = page()
  const r = await load(env)(ARGS)
  assert.equal(r.status, 'published')
  assert.equal(r.url, 'https://segmentfault.com/a/1190000047000001')
  const [, body] = env.calls.find((c) => c[0] === 'postArticle')
  assert.equal(body.draft_id, '1220000048325812')
  assert.equal(body.type, 1)
  assert.equal(body.text, '# md body')
  assert.equal(body.license, 0)
})

test('a post held for manual review says in_review', async () => {
  const env = page({ post: async () => ({ data: { id: 1190000047000002 }, msg: '你的文章将由人工审核后发布，通常这个过程不会超过四小时' }) })
  const r = await load(env)(ARGS)
  assert.equal(r.status, 'in_review')
  assert.match(r.message, /人工审核/)
  assert.equal(r.url, 'https://segmentfault.com/a/1190000047000002')
})

test('a verification challenge stops with the draft kept, no retry', async () => {
  const env = page({ post: async () => { throw { scene_id: 'abc' } } })
  const r = await load(env)(ARGS)
  assert.match(r.error, /verification/)
  assert.equal(r.status, 'draft')
  assert.equal(r.draft_id, '1220000048325812')
})

test('a publish error surfaces the server message', async () => {
  const env = page({ post: async () => { throw { isError: true, title: '标题太短' } } })
  const r = await load(env)(ARGS)
  assert.match(r.error, /标题太短/)
  assert.match(r.hint, /Do not re-run/)
})

test('publishing with no existing tag, or 转载 without a source, is refused before saving', async () => {
  let env = page()
  let r = await load(env)({ ...ARGS, tags: 'AI编程' })
  assert.match(r.error, /None of the tags/)
  assert.equal(env.calls.length, 0)
  env = page()
  r = await load(env)({ ...ARGS, type: '转载' })
  assert.match(r.error, /source_url/)
  assert.equal(env.calls.length, 0)
  r = await load(env)({ ...ARGS, type: '搬运' })
  assert.match(r.error, /Unknown type/)
})

test('signed out, or a changed bundle, fails before writing', async () => {
  let env = page({ user: null })
  let r = await load(env)(ARGS)
  assert.match(r.error, /Not signed in/)
  assert.equal(env.calls.length, 0)
  r = await load({ window: {} })(ARGS)
  assert.match(r.error, /API client/)
})

test('install.sh ships every segmentfault adapter in this directory', () => {
  const install = fs.readFileSync(new URL('../install.sh', import.meta.url), 'utf8')
  const onDisk = fs.readdirSync(new URL('.', import.meta.url)).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
  assert.deepEqual(onDisk.filter((f) => !install.includes('segmentfault/' + f)), [])
})
