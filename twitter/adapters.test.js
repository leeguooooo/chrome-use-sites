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
