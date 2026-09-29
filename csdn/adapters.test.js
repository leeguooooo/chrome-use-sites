import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

// csdn/article-publish writes to a real account; it is exercised here against
// a stubbed editor page. The live check is one draft, deleted straight after.

const SAVE_SRC =
  'var Mn=n(58230),In=n(95516);function di(e){return Mn.A.request({method:"POST",url:"".concat("https://bizapi.csdn.net/blog-console-api/","v3/mdeditor/saveArticle"),withCredentials:!0,body:e},!1)}'

/** The editor's signed request client, answering `routes[url](config)`. */
function client(routes, calls) {
  return {
    request: async (config, a, b) => {
      calls.push(config)
      const route = routes[config.url]
      const body = typeof route === 'function' ? route(config) : route
      if (body === undefined) return { status: 404, body: { code: 404, msg: 'not found' } }
      return { status: 200, body }
    },
  }
}

/** A window whose webpack registry holds the editor bundle (module 58230 = client). */
function editorWindow(c) {
  const req = (id) => ({ 58230: { A: c } })[id]
  req.m = {
    1: function () { return 'unrelated' },
    10440: new Function('e', 't', 'n', SAVE_SRC),
  }
  return { webpackChunkcsdnEdit: { push: ([, , cb]) => cb(req) } }
}

const ROUTES = {
  'https://bizapi.csdn.net/blog-console-api/v3/editor/getBaseInfo': { code: 200, data: { name: 'u_1', blog_level: 1 } },
  'https://bizapi.csdn.net/blog/phoenix/console/v1/tag/search-recommend-tag': (c) => ({
    code: 200,
    data: ({ 'AI编程': ['ai编程', 'AI编程', 'ai'], 人工智能: ['人工智能', '人工智能作画'], claude: ['c++', 'icloud'] })[c.body.key.toLowerCase()] ||
      ({ AI编程: ['ai编程', 'AI编程', 'ai'] })[c.body.key] || [],
  }),
  'https://bizapi.csdn.net/blog-console-api/v3/mdeditor/saveArticle': { code: 200, data: { article_id: 166000001, url: 'https://blog.csdn.net/u_1/article/details/166000001' } },
}

function load({ win, doc, host = 'editor.csdn.net' }) {
  const src = fs.readFileSync(new URL('./article-publish.js', import.meta.url), 'utf8')
  const fastTimeout = (fn) => { fn(); return 0 }
  return new Function('window', 'document', 'location', 'setTimeout', `return (${src})`)(win, doc, { hostname: host }, fastTimeout)
}

const ARGS = { title: '标题标题标题', markdown: '# H\n\n**b** `c`\n\n```bash\necho 1\n```', summary: 'S', tags: 'Claude,AI编程,人工智能' }
const saveCall = (calls) => calls.find((c) => c.url.endsWith('saveArticle'))

test('draft=true saves with status 2, original, public, and the rendered HTML', async () => {
  const calls = []
  const r = await load({ win: editorWindow(client(ROUTES, calls)) })({ ...ARGS, draft: 'true' })
  assert.equal(r.ok, true)
  assert.equal(r.status, 'draft')
  assert.equal(r.id, '166000001')
  const b = saveCall(calls).body
  assert.equal(b.status, 2)
  assert.equal(b.pubStatus, 'draft')
  assert.equal(b.type, 'original')
  assert.equal(b.readType, 'public')
  assert.equal(b.markdowncontent, ARGS.markdown)
  assert.equal(b.content, '<h1>H</h1><p><strong>b</strong> <code>c</code></p><pre><code class="prism language-bash">echo 1</code></pre>')
  assert.equal(b.Description, 'S')
  assert.equal(b.id, '')
})

test('publish uses status 0 and returns the blog URL', async () => {
  const calls = []
  const r = await load({ win: editorWindow(client(ROUTES, calls)) })(ARGS)
  assert.equal(r.status, 'published')
  assert.equal(r.url, 'https://blog.csdn.net/u_1/article/details/166000001')
  assert.equal(saveCall(calls).body.status, 0)
  assert.equal(saveCall(calls).body.pubStatus, 'publish')
})

test('--id overwrites that article instead of creating one', async () => {
  const calls = []
  await load({ win: editorWindow(client(ROUTES, calls)) })({ ...ARGS, id: '166853988' })
  assert.equal(saveCall(calls).body.id, '166853988')
})

test('tags: only existing ones, exact case preferred; the rest are reported', async () => {
  const calls = []
  const r = await load({ win: editorWindow(client(ROUTES, calls)) })({ ...ARGS, draft: 'true' })
  assert.deepEqual(r.tags, ['AI编程', '人工智能'])
  assert.deepEqual(r.skipped_tags, ['Claude'])
  assert.equal(saveCall(calls).body.tags, 'AI编程,人工智能')
})

test('publishing with no existing tag is refused before saving', async () => {
  const calls = []
  const r = await load({ win: editorWindow(client(ROUTES, calls)) })({ ...ARGS, tags: 'Claude' })
  assert.match(r.error, /None of the tags/)
  assert.match(r.hint, /blog level 1/)
  assert.equal(saveCall(calls), undefined)
})

test('off the editor page it borrows the editor from a hidden same-origin frame, then removes it', async () => {
  const calls = []
  const frameWin = editorWindow(client(ROUTES, calls))
  const appended = []
  let removed = false
  const doc = {
    createElement: (tag) => {
      assert.equal(tag, 'iframe')
      const f = { style: {}, contentWindow: null, remove: () => { removed = true } }
      return f
    },
    body: { appendChild: (f) => { appended.push(f); f.contentWindow = frameWin } },
  }
  const r = await load({ win: {}, doc })({ ...ARGS, draft: 'true' })
  assert.equal(r.ok, true)
  assert.equal(appended.length, 1)
  assert.match(appended[0].src, /^https:\/\/editor\.csdn\.net\/md\//)
  assert.ok(removed)
})

test('a changed bundle or another host fails with a clear error', async () => {
  const doc = { createElement: () => ({ style: {}, remove() {} }), body: { appendChild: () => {} } }
  let r = await load({ win: {}, doc })(ARGS)
  assert.match(r.error, /request client/)
  r = await load({ win: {}, doc, host: 'blog.csdn.net' })(ARGS)
  assert.match(r.error, /editor\.csdn\.net/)
})

test('signed out: stops before saving', async () => {
  const calls = []
  const routes = { ...ROUTES, 'https://bizapi.csdn.net/blog-console-api/v3/editor/getBaseInfo': { code: 401, msg: '未登录' } }
  const r = await load({ win: editorWindow(client(routes, calls)) })(ARGS)
  assert.match(r.error, /Not signed in/)
  assert.equal(saveCall(calls), undefined)
})

test('the markdown converter is the same code in csdn/ and zhihu/', () => {
  const block = (f) => {
    const s = fs.readFileSync(new URL(f, import.meta.url), 'utf8')
    const a = s.indexOf('// ---- markdown → html')
    const b = s.indexOf('// ---- end markdown → html')
    assert.ok(a > 0 && b > a, f + ' has no converter block')
    return s.slice(a, b)
  }
  assert.equal(block('./article-publish.js'), block('../zhihu/article-publish.js'))
})

test('markdown converter: blocks and inlines', async () => {
  const calls = []
  const md = [
    '> quote with [link](https://a.b/c_d_e)',
    '',
    '- one **bold**',
    '- two `x<y`',
    '',
    '1. first',
    '2. second',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    'snake_case_word *em* ~~del~~ ![img](https://i/x.png) <script>',
    '',
    '---',
    '```',
    '<b>raw</b>',
    '```',
  ].join('\n')
  await load({ win: editorWindow(client(ROUTES, calls)) })({ ...ARGS, markdown: md, draft: 'true' })
  assert.equal(
    saveCall(calls).body.content,
    '<blockquote><p>quote with <a href="https://a.b/c_d_e">link</a></p></blockquote>' +
      '<ul><li>one <strong>bold</strong></li><li>two <code>x&lt;y</code></li></ul>' +
      '<ol><li>first</li><li>second</li></ol>' +
      '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>' +
      '<p>snake_case_word <em>em</em> <del>del</del> <img src="https://i/x.png" alt="img"> &lt;script&gt;</p>' +
      '<hr><pre><code>&lt;b&gt;raw&lt;/b&gt;</code></pre>',
  )
})

test('install.sh ships every csdn adapter in this repo', () => {
  const install = fs.readFileSync(new URL('../install.sh', import.meta.url), 'utf8')
  const onDisk = fs.readdirSync(new URL('.', import.meta.url)).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
  assert.deepEqual(onDisk.filter((f) => !install.includes('csdn/' + f)), [])
})
