import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { createPage } from '../douyin-creator/fakedom.mjs'

// google/search runs in a www.google.com tab and reads Google's same-origin
// result pages. Fixtures are synthetic pages in Google's result markup,
// trimmed to what the adapter reads.

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const bodyOf = (html) => (/<body[^>]*>([\s\S]*)<\/body>/.exec(html) || [, html])[1]

class DOMParser {
  parseFromString(html) { return createPage({ html: bodyOf(html) }).document }
}

function loadAdapter(fetch, { url = 'https://www.google.com/', html = '', loc } = {}) {
  const src = fs.readFileSync(new URL('./search.js', import.meta.url), 'utf8')
  const page = createPage({ html, url })
  return new Function('fetch', 'DOMParser', 'location', 'document', `return (${src})`)(
    fetch, DOMParser, loc || new URL(url), page.document)
}

// routes: { '/search?q=…': 'file.html' } keyed by path + search.
function google(routes, extra = {}) {
  const calls = []
  const fetch = async (url) => {
    const u = new URL(url, 'https://www.google.com/')
    calls.push(u.pathname + u.search)
    if (extra.sorry) return { ok: false, status: 429, url: 'https://www.google.com/sorry/index', text: async () => '' }
    const name = routes[u.pathname + u.search]
    if (!name) return { ok: false, status: 404, url: u.href, text: async () => '' }
    return { ok: true, status: 200, url: u.href, text: async () => fixture(name) }
  }
  return { fetch, calls }
}

test('search returns absolute urls, display url, domain and snippet', async () => {
  const g = google({ '/search?q=chrome%20use': 'results-p1.html' })
  const out = await loadAdapter(g.fetch)({ query: 'chrome use' })
  assert.equal(out.error, undefined, JSON.stringify(out))
  assert.equal(out.count, 3)
  assert.deepEqual(out.results[0], {
    title: 'Chrome Use & agents',
    url: 'https://www.google.com/goto?url=CAESabc123token',
    domain: 'github.com',
    display_url: 'https://github.com › leeguooooo › chrome-use',
    redirect: true,
    snippet: "Browser automation in the user's real, logged-in Chrome for AI agents.",
  })
  assert.equal(out.results[1].url, 'https://example.com/docs?a=1')
  assert.equal(out.results[1].domain, 'example.com')
  assert.equal(out.results[1].redirect, false)
  assert.match(out.results[1].snippet, /url q parameter/)
  assert.equal(out.results[2].url, 'https://news.example.org/story')
  assert.equal(out.results[2].domain, 'news.example.org')
  assert.ok(!out.results.some((r) => r.title === 'People also search'), 'internal /search links are not results')
  assert.deepEqual(g.calls, ['/search?q=chrome%20use'], 'count 10 reads one page')
})

test('count past 10 reads the next page with start=10 and stops at count', async () => {
  const g = google({ '/search?q=x': 'results-p1.html', '/search?q=x&start=10': 'results-p2.html' })
  const out = await loadAdapter(g.fetch)({ query: 'x', count: '4' })
  assert.deepEqual(g.calls, ['/search?q=x'])
  assert.equal(out.count, 3)
  const more = google({ '/search?q=x': 'results-p1.html', '/search?q=x&start=10': 'results-p2.html' })
  const out2 = await loadAdapter(more.fetch)({ query: 'x', count: '15' })
  assert.deepEqual(more.calls, ['/search?q=x', '/search?q=x&start=10'])
  assert.equal(out2.count, 4)
  assert.equal(out2.results[3].title, 'Second page result')
})

test('a page Google says has no results is an empty result, not an error', async () => {
  const out = await loadAdapter(google({ '/search?q=zzqqxx': 'no-results.html' }).fetch)({ query: 'zzqqxx' })
  assert.deepEqual(out, { query: 'zzqqxx', count: 0, results: [], no_results: true })
})

test('a page that parses to nothing is an error with a hint, never a silent count 0', async () => {
  const out = await loadAdapter(google({ '/search?q=q': 'js-only.html' }).fetch)({ query: 'q' })
  assert.match(out.error, /No results could be read/)
  assert.match(out.hint, /\/search\?q=q/)
})

test('a script check off the results page loads the results page in the tab and asks for a rerun', async () => {
  const assigned = []
  const loc = Object.assign(new URL('https://www.google.com/'), { assign: (u) => assigned.push(u) })
  const out = await loadAdapter(google({ '/search?q=a%20b': 'js-only.html' }).fetch, { loc })({ query: 'a b' })
  assert.match(out.error, /script check/)
  assert.match(out.hint, /Run the same command again/)
  assert.equal(out.retry, true)
  assert.deepEqual(assigned, [], 'the tab moves only after the result is returned')
  await new Promise((r) => setTimeout(r, 900))
  assert.deepEqual(assigned, ['https://www.google.com/search?q=a%20b'])
})

test('when the fetched page is empty but the tab shows this query, the rendered page is read', async () => {
  const out = await loadAdapter(google({ '/search?q=q': 'js-only.html' }).fetch, {
    url: 'https://www.google.com/search?q=q',
    html: bodyOf(fixture('results-p1.html')),
  })({ query: 'q' })
  assert.equal(out.error, undefined, JSON.stringify(out))
  assert.equal(out.count, 3)
})

test('a CAPTCHA redirect and a missing query are errors', async () => {
  const sorry = await loadAdapter(google({}, { sorry: true }).fetch)({ query: 'q' })
  assert.match(sorry.error, /CAPTCHA/)
  const missing = await loadAdapter(google({}).fetch)({})
  assert.match(missing.error, /Missing argument/)
})

test('install.sh ships google/search', () => {
  const install = fs.readFileSync(new URL('../install.sh', import.meta.url), 'utf8')
  assert.match(install, /google\/search\.js/)
})
