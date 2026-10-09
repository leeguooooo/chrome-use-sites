import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import test from 'node:test'

// youtube-studio/channel reads the signed-in channel through Studio's own
// innertube endpoints. Responses are the ones captured on 2026-10-09
// (fixtures/get_creator_channels.json, list_creator_videos.json).

const fixture = (name) => {
  const d = JSON.parse(fs.readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8'))
  delete d._fixture
  return d
}

const CFG = {
  CHANNEL_ID: 'UClunnXMSPA-51fr1Ivn28xw',
  INNERTUBE_API_KEY: 'key-1',
  INNERTUBE_CONTEXT: { client: { clientName: 'WEB_CREATOR' } },
  INNERTUBE_CONTEXT_CLIENT_NAME: 62,
  INNERTUBE_CONTEXT_CLIENT_VERSION: '1.0',
}

function load(fetchImpl, { cfg = CFG, cookie = 'SAPISID=abc; other=1' } = {}) {
  const src = fs.readFileSync(new URL('./channel.js', import.meta.url), 'utf8')
  const window = { ytcfg: { get: (k) => cfg[k] } }
  const document = { cookie }
  const location = { origin: 'https://studio.youtube.com' }
  return new Function('window', 'document', 'location', 'fetch', 'crypto', `return (${src})`)(
    window, document, location, fetchImpl, crypto.webcrypto,
  )
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body })

function studio({ pages = [fixture('list_creator_videos.json')], seen = [] } = {}) {
  let page = 0
  return async (url, init) => {
    const path = new URL(url, 'https://studio.youtube.com').pathname
    const body = JSON.parse(init.body)
    seen.push({ path, body, headers: init.headers })
    if (path.endsWith('/creator/get_creator_channels')) return ok(fixture('get_creator_channels.json'))
    if (path.endsWith('/creator/list_creator_videos')) return ok(pages[page++])
    throw new Error('unexpected ' + path)
  }
}

test('channel totals and uploads, Shorts included', async () => {
  const seen = []
  const out = await load(studio({ seen }))({ limit: 10 })
  assert.equal(out.title, '郭立')
  assert.equal(out.subscribers, 1)
  assert.equal(out.videos, 6)
  assert.equal(out.total_views, 629)
  assert.equal(out.uploads.length, 6)
  const short = out.uploads.find((u) => u.type === 'short')
  assert.equal(short.views, 167)
  assert.equal(short.url, 'https://www.youtube.com/shorts/VnOQXy1INd0')
  assert.equal(out.uploads[0].video_id, 'k5MsBZcjUVs')
  assert.equal(out.uploads[0].visibility, 'public')
  assert.equal(out.uploads[0].views, 79)
  // Auth and delegation the way Studio sends them.
  const call = seen[0]
  assert.match(call.headers.Authorization, /^SAPISIDHASH \d+_[0-9a-f]{40}$/)
  assert.equal(call.body.context.user.delegationContext.externalChannelId, CFG.CHANNEL_ID)
  // The list filter must not drop Shorts the way Studio's Videos tab does.
  const list = seen.find((s) => s.path.endsWith('list_creator_videos'))
  assert.ok(!JSON.stringify(list.body.filter).includes('SHORTS'))
})

test('limit 0 is totals only; limit pages with nextPageToken', async () => {
  const seen = []
  const totals = await load(studio({ seen }))({ limit: 0 })
  assert.equal(totals.uploads, undefined)
  assert.equal(seen.length, 1)

  const all = fixture('list_creator_videos.json').videos
  const pages = [{ videos: all.slice(0, 3), nextPageToken: 't2' }, { videos: all.slice(3) }]
  const seen2 = []
  const out = await load(studio({ pages, seen: seen2 }))({ limit: 5 })
  assert.equal(out.uploads.length, 5)
  const lists = seen2.filter((s) => s.path.endsWith('list_creator_videos'))
  assert.equal(lists[1].body.pageToken, 't2')
})

test('private and draft uploads are labelled', async () => {
  const v = fixture('list_creator_videos.json').videos
  const pages = [{ videos: [
    { ...v[0], privacy: 'VIDEO_PRIVACY_PRIVATE' },
    { ...v[2], draftStatus: 'DRAFT_STATUS_SAVED' },
    { ...v[3], privacy: 'VIDEO_PRIVACY_UNLISTED' },
  ] }]
  const out = await load(studio({ pages }))({})
  assert.deepEqual(out.uploads.map((u) => u.visibility), ['private', 'draft', 'unlisted'])
})

test('not on Studio / signed out', async () => {
  const off = await load(studio(), { cfg: {} })({})
  assert.match(off.error, /Studio/)
  const noCookie = await load(studio(), { cookie: '' })({})
  assert.match(noCookie.error, /SAPISID/)
  const denied = await load(async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Unauthorized' } }) }))({})
  assert.match(denied.error, /401/)
  assert.match(denied.hint, /Sign in/)
})
