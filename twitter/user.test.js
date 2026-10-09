import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

// twitter/user against both shapes X has served UserByScreenName in: the
// older one with everything in `legacy`, and the 2026 one where the counts
// moved to relationship_counts / tweet_counts / action_counts.

function load(fetchImpl, { profileHref = '/leeguooooo', cookie = 'ct0=t' } = {}) {
  const src = fs.readFileSync(new URL('./user.js', import.meta.url), 'utf8')
  const document = {
    cookie,
    querySelector: (sel) =>
      sel === '[data-testid="AppTabBar_Profile_Link"]' && profileHref
        ? { getAttribute: () => profileHref }
        : null,
  }
  return new Function('document', 'findGraphQLQueryId', 'fetch', `return (${src})`)(document, () => 'qid', fetchImpl)
}

const reply = (result) => async () => ({ ok: true, status: 200, json: async () => ({ data: { user: { result } } }) })

const NEW = {
  __typename: 'User',
  rest_id: '1563801091912843264',
  core: { created_at: 'Sun Aug 28 08:10:33 +0000 2022', name: '郭立 Guo Li', screen_name: 'leeguooooo' },
  profile_bio: { description: 'I build and test AI-agent tools.' },
  location: { location: 'Tokyo' },
  relationship_counts: { followers: 23, following: 26 },
  tweet_counts: { media_tweets: 30, tweets: 160 },
  action_counts: { favorites_count: 37 },
  website: { url: 'https://t.co/x' },
  pinned_items: { tweet_ids_str: ['2107136904038916354'] },
  is_blue_verified: false,
}

const OLD = {
  rest_id: '44196397',
  legacy: {
    name: 'Old Shape', screen_name: 'oldshape', description: 'bio', location: 'Mars',
    followers_count: 5, friends_count: 6, statuses_count: 7, media_count: 8, favourites_count: 9,
    pinned_tweet_ids_str: ['1'],
    entities: { url: { urls: [{ expanded_url: 'https://example.com' }] } },
  },
  is_blue_verified: true,
}

test('2026 shape: counts come from the new objects', async () => {
  const out = await load(reply(NEW))({ screen_name: 'leeguooooo' })
  assert.deepEqual(
    { followers: out.followers, following: out.following, tweets: out.tweets, media: out.media, likes: out.likes },
    { followers: 23, following: 26, tweets: 160, media: 30, likes: 37 },
  )
  assert.equal(out.name, '郭立 Guo Li')
  assert.equal(out.url, 'https://x.com/leeguooooo')
  assert.equal(out.bio, 'I build and test AI-agent tools.')
  assert.equal(out.location, 'Tokyo')
  assert.deepEqual(out.pinned_tweet_ids, ['2107136904038916354'])
})

test('legacy shape still works', async () => {
  const out = await load(reply(OLD))({ screen_name: 'oldshape' })
  assert.equal(out.screen_name, 'oldshape')
  assert.equal(out.followers, 5)
  assert.equal(out.following, 6)
  assert.equal(out.tweets, 7)
  assert.equal(out.likes, 9)
  assert.equal(out.website, 'https://example.com')
  assert.equal(out.verified, true)
})

test('no handle: reads the signed-in one from the side nav', async () => {
  let asked
  const fetch = async (url) => {
    asked = JSON.parse(new URL(url, 'https://x.com').searchParams.get('variables')).screen_name
    return reply(NEW)()
  }
  await load(fetch)({})
  assert.equal(asked, 'leeguooooo')
  await load(fetch)({ screen_name: 'https://x.com/elonmusk' })
  assert.equal(asked, 'elonmusk')
  const none = await load(fetch, { profileHref: null })({})
  assert.match(none.error, /signed in/)
})

test('missing user and missing cookie are errors', async () => {
  const gone = await load(reply({ __typename: 'UserUnavailable' }))({ screen_name: 'nobody' })
  assert.match(gone.error, /not found/)
  const out = await load(reply(NEW), { cookie: '' })({ screen_name: 'x' })
  assert.match(out.error, /ct0/)
})
