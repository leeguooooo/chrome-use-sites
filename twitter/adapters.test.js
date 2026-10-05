import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

function loadAdapter(filename, overrides = {}) {
  const source = fs.readFileSync(new URL(filename, import.meta.url), 'utf8')
  return new Function(
    'document',
    'findTransactionIdGenerator',
    'findGraphQLQueryId',
    'fetch',
    `return (${source})`,
  )(
    overrides.document || { cookie: 'ct0=test-token' },
    overrides.findTransactionIdGenerator || (async () => async () => 'transaction-id'),
    overrides.findGraphQLQueryId || (() => 'query-id'),
    overrides.fetch,
  )
}

function tweetResult() {
  return {
    rest_id: '123',
    legacy: {
      full_text: 'hello',
      reply_count: 2,
      bookmark_count: 3,
    },
    views: { count: '456' },
    core: {
      user_results: {
        result: { legacy: { screen_name: 'tester', name: 'Tester' } },
      },
    },
  }
}

test('search defaults invalid counts, caps valid counts, and keeps metrics stable', async () => {
  const requestedCounts = []
  const adapter = loadAdapter('./search.js', {
    fetch: async (url) => {
      const parsed = new URL(url, 'https://x.com')
      requestedCounts.push(JSON.parse(parsed.searchParams.get('variables')).count)
      return {
        ok: true,
        json: async () => ({
          data: {
            search_by_raw_query: {
              search_timeline: {
                timeline: {
                  instructions: [
                    {
                      entries: [
                        {
                          content: {
                            itemContent: { tweet_results: { result: tweetResult() } },
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
        }),
      }
    },
  })

  for (const count of ['-1', '0', 'not-a-number', '60']) {
    const result = await adapter({ query: 'chrome-use', count })
    assert.equal(result.tweets[0].likes, null)
    assert.equal(result.tweets[0].retweets, null)
    assert.equal(result.tweets[0].replies, 2)
    assert.equal(result.tweets[0].bookmarks, 3)
    assert.equal(result.tweets[0].views, 456)
  }
  assert.deepEqual(requestedCounts, [20, 20, 20, 50])
})

test('thread fails before fetch when the TweetDetail query ID is unavailable', async () => {
  let fetchCalled = false
  const adapter = loadAdapter('./thread.js', {
    findGraphQLQueryId: () => null,
    fetch: async () => {
      fetchCalled = true
    },
  })

  const result = await adapter({ tweet_id: '123' })
  assert.match(result.error, /Cannot find TweetDetail queryId/)
  assert.equal(fetchCalled, false)
})

test('thread keeps missing engagement metrics as null', async () => {
  const adapter = loadAdapter('./thread.js', {
    fetch: async () => ({
      ok: true,
      json: async () => ({
        data: {
          threaded_conversation_with_injections_v2: {
            instructions: [
              {
                entries: [
                  {
                    content: {
                      itemContent: { tweet_results: { result: tweetResult() } },
                    },
                  },
                ],
              },
            ],
          },
        },
      }),
    }),
  })

  const result = await adapter({ tweet_id: '123' })
  assert.equal(result.tweets[0].likes, null)
  assert.equal(result.tweets[0].retweets, null)
  assert.equal(result.tweets[0].replies, 2)
  assert.equal(result.tweets[0].bookmarks, 3)
  assert.equal(result.tweets[0].views, 456)
})

// chrome-use-sites#4: the tests above stub findGraphQLQueryId and
// findTransactionIdGenerator, so they pass whether or not the real helper is
// installed — which is how install.sh shipped a twitter pack that threw
// "findGraphQLQueryId is not defined". Those functions live in the community
// pack's twitter/_helper.js (epiral/bb-sites), so the installer has to fetch
// that file from there, pinned to a commit.
const HELPER_FNS = ['findGraphQLQueryId', 'findTransactionIdGenerator']

test('install.sh fetches the helper the twitter adapters call into', () => {
  const install = fs.readFileSync(new URL('../install.sh', import.meta.url), 'utf8')
  const external = (install.match(/^EXTERNAL="([^"]*)"/m) || [, ''])[1]
    .split(/\s+/)
    .filter(Boolean)
    .map((e) => e.split('='))
  const adapters = fs
    .readdirSync(new URL('.', import.meta.url))
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && f !== '_helper.js')
  const needsHelper = adapters.filter((f) => {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8')
    return HELPER_FNS.some((fn) => src.includes(fn + '('))
  })
  assert.ok(needsHelper.length > 0, 'expected search.js/thread.js to call the helper')

  const localHelper = fs.existsSync(new URL('./_helper.js', import.meta.url))
  const helper = external.find(([dest]) => dest === 'twitter/_helper.js')
  assert.ok(
    localHelper || helper,
    `${needsHelper.join(', ')} call ${HELPER_FNS.join('/')} but install.sh fetches no twitter/_helper.js`,
  )
  if (helper) {
    // A branch ref would let an upstream rename silently break the pack.
    assert.match(helper[1], /\/[0-9a-f]{40}\/twitter\/_helper\.js$/, 'pin the helper to a full commit SHA')
  }
})

// twitter/post: weighting, dry run, reply, success and refusal paths.
test('post counts CJK as 2 and links as 23, refusing over 280 before any request', async () => {
  let called = false
  const adapter = loadAdapter('./post.js', { fetch: async () => { called = true } })
  const ok = await adapter({ text: '你好 https://github.com/leeguooooo/iphone-use/with/a/very/long/path', dry_run: 'true' })
  assert.equal(ok.weighted_length, 2 * 2 + 1 + 23)
  const long = await adapter({ text: '字'.repeat(141) })
  assert.match(long.error, /too long: 282 of 280/)
  assert.equal(called, false)
})

test('post dry run returns the variables, including a reply target from a URL', async () => {
  const adapter = loadAdapter('./post.js', { fetch: async () => assert.fail('dry run must not post') })
  const r = await adapter({ text: 'hi', reply_to: 'https://x.com/a/status/42', dry_run: 'true' })
  assert.equal(r.dry_run, true)
  assert.equal(r.variables.tweet_text, 'hi')
  assert.deepEqual(r.variables.reply, { in_reply_to_tweet_id: '42', exclude_reply_user_ids: [] })
})

test('post sends CreateTweet with a transaction id and returns the tweet url', async () => {
  let seen
  const adapter = loadAdapter('./post.js', {
    fetch: async (url, init) => {
      seen = { url, init }
      return {
        ok: true,
        json: async () => ({ data: { create_tweet: { tweet_results: { result: {
          rest_id: '777', core: { user_results: { result: { legacy: { screen_name: 'leeguooooo' } } } },
        } } } } }),
      }
    },
  })
  const r = await adapter({ text: 'hello' })
  assert.equal(r.ok, true)
  assert.equal(r.url, 'https://x.com/leeguooooo/status/777')
  assert.match(seen.url, /\/CreateTweet$/)
  assert.equal(seen.init.method, 'POST')
  assert.equal(seen.init.headers['X-Client-Transaction-Id'], 'transaction-id')
  assert.equal(JSON.parse(seen.init.body).variables.tweet_text, 'hello')
})

test('post reports a refusal as not posted, and a missing id as unknown', async () => {
  const refused = loadAdapter('./post.js', {
    fetch: async () => ({ ok: true, json: async () => ({ errors: [{ message: 'Status is a duplicate.' }] }) }),
  })
  const r1 = await refused({ text: 'hello' })
  assert.match(r1.error, /duplicate/)
  assert.match(r1.hint, /Nothing was posted/)
  const empty = loadAdapter('./post.js', { fetch: async () => ({ ok: true, json: async () => ({ data: {} }) }) })
  const r2 = await empty({ text: 'hello' })
  assert.equal(r2.outcome, 'unknown')
})

test('post needs a session', async () => {
  const adapter = loadAdapter('./post.js', { document: { cookie: '' } })
  const r = await adapter({ text: 'hello' })
  assert.match(r.error, /Not signed in/)
})

function mediaDoc() {
  const nodes = {}
  return {
    cookie: 'ct0=test-token',
    getElementById: (id) => nodes[id] || null,
    createElement: () => ({ style: {}, files: null }),
    body: { appendChild: (el) => { nodes[el.id] = el } },
    nodes,
  }
}

function localVideo(doc, bytes) {
  const blob = new Blob([new Uint8Array(bytes)], { type: 'video/mp4' })
  const file = Object.assign(blob, { name: 'clip.mp4' })
  return {
    name: 'clip.mp4',
    size: bytes,
    setOn: async (sel) => { doc.nodes[sel.slice(1)].files = [file] },
  }
}

test('post uploads a video in chunks, waits for processing, then tweets it', async () => {
  const doc = mediaDoc()
  const calls = []
  let statusPolls = 0
  const adapter = loadAdapter('./post.js', {
    document: doc,
    fetch: async (url, init) => {
      const u = new URL(url, 'https://x.com')
      const cmd = u.searchParams.get('command')
      calls.push(cmd || u.pathname)
      if (cmd === 'INIT') return { ok: true, json: async () => ({ media_id_string: 'M1' }) }
      if (cmd === 'APPEND') return { ok: true, json: async () => { throw new Error('empty') } }
      if (cmd === 'FINALIZE') return { ok: true, json: async () => ({ processing_info: { state: 'pending', check_after_secs: 0.001 } }) }
      if (cmd === 'STATUS') {
        statusPolls++
        return { ok: true, json: async () => ({ processing_info: { state: 'succeeded' } }) }
      }
      const body = JSON.parse(init.body)
      assert.deepEqual(body.variables.media.media_entities, [{ media_id: 'M1', tagged_users: [] }])
      return { ok: true, json: async () => ({ data: { create_tweet: { tweet_results: { result: { rest_id: '9' } } } } }) }
    },
  })
  const r = await adapter({ text: 'video', media: localVideo(doc, 9 * 1024 * 1024) })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.deepEqual(r.media, ['M1'])
  assert.deepEqual(calls.slice(0, 5), ['INIT', 'APPEND', 'APPEND', 'APPEND', 'FINALIZE'])
  assert.equal(statusPolls, 1)
})

test('post stops before tweeting when the media upload fails', async () => {
  const doc = mediaDoc()
  let tweeted = false
  const adapter = loadAdapter('./post.js', {
    document: doc,
    fetch: async (url) => {
      const cmd = new URL(url, 'https://x.com').searchParams.get('command')
      if (cmd === 'INIT') return { ok: false, status: 403, json: async () => ({ error: 'forbidden' }) }
      tweeted = true
      return { ok: true, json: async () => ({}) }
    },
  })
  const r = await adapter({ text: 'video', media: localVideo(doc, 1024) })
  assert.match(r.error, /INIT: HTTP 403/)
  assert.match(r.hint, /Nothing was posted/)
  assert.equal(tweeted, false)
})
