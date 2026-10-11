import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

// hackernews/top and hackernews/thread run in a news.ycombinator.com tab,
// whose CSP (`default-src 'self'`, no connect-src) blocks any fetch to another
// origin, hacker-news.firebaseio.com included. The stub below plays that CSP:
// a request off news.ycombinator.com fails the way Chrome fails it. Fixtures in
// fixtures/ are synthetic pages in HN's markup, trimmed to what the adapters read.

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

function loadAdapter(file, fetch) {
  const src = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
  return new Function('fetch', `return (${src})`)(fetch)
}

// routes: { '/news': 'news-p1.html', ... } keyed by path + search.
function hnPage(routes) {
  const calls = []
  const fetch = async (url) => {
    const u = new URL(url, 'https://news.ycombinator.com/')
    calls.push(u.href)
    if (u.origin !== 'https://news.ycombinator.com') throw new TypeError('Failed to fetch')
    const name = routes[u.pathname + u.search]
    if (!name) return { ok: false, status: 404, text: async () => '' }
    return { ok: true, status: 200, text: async () => fixture(name) }
  }
  return { fetch, calls }
}

test('top reads the same-origin front page, never another origin', async () => {
  const page = hnPage({ '/news': 'news-p1.html' })
  const out = await loadAdapter('./top.js', page.fetch)({ count: '3' })
  assert.equal(out.error, undefined, JSON.stringify(out))
  assert.deepEqual(page.calls, ['https://news.ycombinator.com/news'])
  assert.deepEqual(out.data.posts[0], {
    rank: 1,
    id: 101,
    title: 'First HN story & friends',
    url: 'https://example.com/first',
    hn_url: 'https://news.ycombinator.com/item?id=101',
    author: 'alice',
    score: 42,
    comments: 7,
  })
})

test('top: self posts have no url, "discuss" is 0 comments, job ads are omitted', async () => {
  const page = hnPage({ '/news': 'news-p1.html', '/news?p=2': 'news-p2.html' })
  const out = await loadAdapter('./top.js', page.fetch)({ count: '4' })
  const [first, ask, third] = out.data.posts
  assert.equal(out.data.count, 3)
  assert.equal(first.id, 101)
  assert.deepEqual(
    { id: ask.id, title: ask.title, url: ask.url, score: ask.score, comments: ask.comments },
    { id: 102, title: 'Ask HN: Second "story"?', url: null, score: 1, comments: 0 },
  )
  assert.deepEqual({ rank: third.rank, id: third.id, comments: third.comments }, { rank: 4, id: 104, comments: 1 })
  const meta = out.__pinix_site_result.metadata
  assert.equal(meta.pagination.non_story_omitted, 1)
  assert.equal(meta.reason, 'limit_truncated_and_selected_items_omitted')
  assert.equal(meta.completeness, 'partial')
  assert.deepEqual(page.calls, ['https://news.ycombinator.com/news'], 'count <= 30 reads one page')
})

test('top pages with ?p=2 past 30 and clamps count to 50', async () => {
  const page = hnPage({ '/news': 'news-p1.html', '/news?p=2': 'news-p2.html' })
  const out = await loadAdapter('./top.js', page.fetch)({ count: '500' })
  assert.deepEqual(page.calls, ['https://news.ycombinator.com/news', 'https://news.ycombinator.com/news?p=2'])
  assert.deepEqual(out.__pinix_site_result.metadata.effective_args, { count: 50 })
  assert.deepEqual(out.data.posts.map((p) => p.id), [101, 102, 104, 131])
  assert.equal(out.data.posts[3].rank, 31)
  assert.equal(out.__pinix_site_result.metadata.pagination.truncated, false)
})

test('top reports an empty front page and HTTP errors', async () => {
  const empty = await loadAdapter('./top.js', hnPage({ '/news': 'news-empty.html' }).fetch)({})
  assert.equal(empty.data.count, 0)
  assert.equal(empty.__pinix_site_result.metadata.completeness, 'empty')
  assert.deepEqual(empty.__pinix_site_result.metadata.effective_args, { count: 20 })
  const failed = await loadAdapter('./top.js', hnPage({}).fetch)({})
  assert.equal(failed.error, 'HTTP 404')
})

test('thread rebuilds the tree from item?id= rows, drops deleted comments and bounds depth', async () => {
  const page = hnPage({ '/item?id=200': 'item-200.html' })
  const out = await loadAdapter('./thread.js', page.fetch)({ id: 'https://news.ycombinator.com/item?id=200', depth: '1' })
  assert.equal(out.error, undefined, JSON.stringify(out))
  assert.deepEqual(page.calls, ['https://news.ycombinator.com/item?id=200'])
  assert.deepEqual(out.data.post, {
    id: 200,
    title: 'Thread story',
    url: 'https://example.com/thread',
    hn_url: 'https://news.ycombinator.com/item?id=200',
    author: 'submitter',
    score: 100,
    comments_count: 6,
    time: 1700000000,
    text: null,
  })
  const [c201, c203] = out.data.comments
  assert.deepEqual(out.data.comments.map((c) => c.id), [201, 203], 'deleted 202 and its reply are dropped')
  assert.equal(c201.author, 'commenter')
  assert.equal(c201.text, 'Visible <i>comment</i> &amp; more<p>Second paragraph', 'text stays HTML like the API')
  assert.equal(c201.depth, 0)
  assert.deepEqual(c201.replies.map((c) => [c.id, c.depth, c.replies.length]), [[204, 1, 0]])
  assert.equal(c203.replies.length, 0)
  const meta = out.__pinix_site_result.metadata
  assert.deepEqual(meta.effective_args, { id: '200', depth: 1 })
  assert.equal(meta.reason, 'comments_omitted')
  assert.equal(meta.pagination.deleted_dead_omitted, 1)
  assert.equal(meta.pagination.depth_truncated, 1)
  assert.equal(meta.pagination.comments_returned, 3)
})

test('thread: a self post has text and no url; a complete tree is complete', async () => {
  const out = await loadAdapter('./thread.js', hnPage({ '/item?id=210': 'item-210.html' }).fetch)({ id: '210' })
  assert.equal(out.data.post.url, null)
  assert.equal(out.data.post.text, 'Body with <a href="https://example.com" rel="nofollow">a link</a>')
  assert.deepEqual(out.data.comments.map((c) => [c.id, c.replies.map((r) => r.id)]), [[211, [212]]])
  assert.equal(out.__pinix_site_result.metadata.completeness, 'complete')
  assert.equal(out.__pinix_site_result.metadata.warnings, undefined)
})

test('thread follows the More link and keeps 30 top-level comments', async () => {
  const page = hnPage({ '/item?id=220': 'item-220.html', '/item?id=220&p=2': 'item-220-p2.html' })
  const out = await loadAdapter('./thread.js', page.fetch)({ id: 220 })
  assert.deepEqual(page.calls, ['https://news.ycombinator.com/item?id=220', 'https://news.ycombinator.com/item?id=220&p=2'])
  assert.equal(out.data.comments.length, 30)
  const meta = out.__pinix_site_result.metadata
  assert.equal(meta.pagination.pages_read, 2)
  assert.equal(meta.pagination.child_limit_truncated, 5)
  assert.equal(meta.completeness, 'partial')
})

test('thread rejects a missing or bad id before fetching, and reports a missing item', async () => {
  const page = hnPage({ '/item?id=999': 'no-such-item.html' })
  const thread = loadAdapter('./thread.js', page.fetch)
  assert.equal((await thread({})).error, 'Missing argument: id')
  assert.match((await thread({ id: 'abc' })).error, /^Bad id/)
  assert.deepEqual(page.calls, [])
  assert.equal((await thread({ id: '999' })).error, 'Item not found')
})
