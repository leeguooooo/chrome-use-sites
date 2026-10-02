import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

// App Store Connect is a real developer account: these adapters are exercised
// here against a stubbed /iris/v1, never in a loop against the live site.

const ORIGIN = 'https://appstoreconnect.apple.com'

/** A fake /iris/v1: `routes['METHOD /path'](url, body)` answers {status, json}. */
function asc(routes = {}) {
  const calls = []
  const fetch = async (url, opts = {}) => {
    const u = new URL(url)
    const method = opts.method || 'GET'
    const body = opts.body ? JSON.parse(opts.body) : null
    calls.push({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), body, opts })
    const route = routes[method + ' ' + u.pathname]
    const res = typeof route === 'function' ? route(u, body) : route || { status: 404, json: { errors: [] } }
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      json: async () => res.json,
      text: async () => JSON.stringify(res.json),
    }
  }
  return { fetch, calls }
}

function load(file, env) {
  const src = fs.readFileSync(new URL('./' + file, import.meta.url), 'utf8')
  return new Function('fetch', 'location', `return (${src})`)(env.fetch, { origin: ORIGIN })
}

const APP = { id: '6700000001', attributes: { name: 'Demo', bundleId: 'com.example.demo', sku: 'demo', primaryLocale: 'en-US' } }

test('apps lists name, bundle id and console url', async () => {
  const env = asc({ 'GET /iris/v1/apps': { status: 200, json: { data: [APP] } } })
  const r = await load('apps.js', env)({})
  assert.equal(r.count, 1)
  assert.deepEqual(r.apps[0], {
    id: '6700000001', name: 'Demo', bundle_id: 'com.example.demo', sku: 'demo',
    primary_locale: 'en-US', url: ORIGIN + '/apps/6700000001',
  })
  assert.equal(env.calls[0].opts.credentials, 'include')
})

test('apps reports a signed-out session instead of an empty list', async () => {
  const env = asc({ 'GET /iris/v1/apps': { status: 401, json: {} } })
  const r = await load('apps.js', env)({})
  assert.match(r.error, /401/)
  assert.match(r.hint, /Not signed in/)
})

test('app-create returns the existing app and never posts', async () => {
  const env = asc({ 'GET /iris/v1/apps': { status: 200, json: { data: [APP] } } })
  const r = await load('app-create.js', env)({ name: 'Other', bundle_id: 'com.example.demo', sku: 'x' })
  assert.equal(r.ok, true)
  assert.equal(r.created, false)
  assert.equal(r.id, '6700000001')
  assert.ok(!env.calls.some((c) => c.method === 'POST'))
})

test('app-create posts one compound document linked by local ids', async () => {
  const env = asc({
    'GET /iris/v1/apps': { status: 200, json: { data: [] } },
    'POST /iris/v1/apps': (u, body) => ({
      status: 201,
      json: { data: { id: '6700000002', attributes: { name: body.data.attributes.name, bundleId: body.data.attributes.bundleId, sku: body.data.attributes.sku } } },
    }),
  })
  const r = await load('app-create.js', env)({ name: 'iPhone Use Remote', bundle_id: 'com.example.remote', sku: 'remote', locale: 'zh-Hans' })
  assert.equal(r.created, true)
  assert.equal(r.id, '6700000002')
  assert.equal(r.url, ORIGIN + '/apps/6700000002')
  const post = env.calls.find((c) => c.method === 'POST')
  assert.equal(post.opts.headers['X-Csrf-Itc'], 'itc')
  assert.deepEqual(post.body.data.attributes, { name: 'iPhone Use Remote', sku: 'remote', primaryLocale: 'zh-Hans', bundleId: 'com.example.remote' })
  const ids = new Set(post.body.included.map((i) => i.type + ':' + i.id))
  for (const rel of Object.values(post.body.data.relationships))
    for (const d of rel.data) assert.ok(ids.has(d.type + ':' + d.id), 'dangling ' + d.type)
  const version = post.body.included.find((i) => i.type === 'appStoreVersions')
  assert.deepEqual(version.attributes, { platform: 'IOS', versionString: '1.0' })
  const loc = post.body.included.find((i) => i.type === 'appInfoLocalizations')
  assert.deepEqual(loc.attributes, { locale: 'zh-Hans', name: 'iPhone Use Remote' })
})

test('app-create surfaces Apple\'s reasons on a 409', async () => {
  const env = asc({
    'GET /iris/v1/apps': { status: 200, json: { data: [] } },
    'POST /iris/v1/apps': { status: 409, json: { errors: [{ detail: 'The App Name you entered is already being used.' }] } },
  })
  const r = await load('app-create.js', env)({ name: 'Taken', bundle_id: 'com.example.t', sku: 't' })
  assert.match(r.error, /409/)
  assert.deepEqual(r.reasons, ['The App Name you entered is already being used.'])
})

test('app-create checks required args and the 30-character name limit', async () => {
  const env = asc()
  assert.match((await load('app-create.js', env)({ name: 'A', sku: 's' })).error, /bundle_id/)
  assert.match((await load('app-create.js', env)({ name: 'x'.repeat(31), bundle_id: 'b', sku: 's' })).error, /30/)
  assert.equal(env.calls.length, 0)
})

test('builds resolves the app then lists newest builds', async () => {
  const env = asc({
    'GET /iris/v1/apps': { status: 200, json: { data: [APP] } },
    'GET /iris/v1/builds': {
      status: 200,
      json: { data: [{ id: 'b1', attributes: { version: '3', processingState: 'PROCESSING', uploadedDate: '2026-10-02T00:00:00Z', expired: false, minOsVersion: '17.0' } }] },
    },
  })
  const r = await load('builds.js', env)({ bundle_id: 'com.example.demo', limit: '5' })
  assert.equal(r.app_id, '6700000001')
  assert.deepEqual(r.builds[0], { id: 'b1', build: '3', state: 'PROCESSING', uploaded: '2026-10-02T00:00:00Z', expired: false, min_os: '17.0' })
  const q = env.calls.find((c) => c.path === '/iris/v1/builds').query
  assert.equal(q['filter[app]'], '6700000001')
  assert.equal(q.limit, '5')
  assert.equal(q.sort, '-uploadedDate')
})

test('builds explains a bundle id with no app', async () => {
  const env = asc({ 'GET /iris/v1/apps': { status: 200, json: { data: [] } } })
  const r = await load('builds.js', env)({ bundle_id: 'com.nope' })
  assert.match(r.error, /No app/)
  assert.match(r.hint, /app-create/)
})
