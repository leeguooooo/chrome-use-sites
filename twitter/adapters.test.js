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
