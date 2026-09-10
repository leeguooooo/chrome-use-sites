import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const HELPER = fs.readFileSync(new URL('./_helper.js', import.meta.url), 'utf8')

// Mirror how chrome-use actually runs these: site::build_eval defines the
// family `_helper.js` in an enclosing scope that the adapter expression closes
// over. If the helper and the adapter were loaded separately here, a missing
// helper function would pass the tests and throw in the browser.
function loadAdapter(filename, overrides = {}) {
  const source = fs.readFileSync(new URL(filename, import.meta.url), 'utf8')
  return new Function(
    'document',
    'fetch',
    `${HELPER}\n;return (${source})`,
  )(
    overrides.document || { querySelectorAll: () => [] },
    overrides.fetch || (async () => ({ ok: false, status: 500 })),
  )
}

const SESSION = { accessToken: 'tok', user: { id: 'u-1', email: 'a@b.c', name: 'Leo' }, expires: '2099-01-01' }

/** A fetch stub routing by path, recording every requested URL. */
function router(routes, seen = []) {
  return async (url, opts) => {
    seen.push(url)
    for (const [prefix, reply] of Object.entries(routes)) {
      if (String(url).startsWith(prefix)) {
        return typeof reply === 'function' ? reply(url, opts) : reply
      }
    }
    return { ok: false, status: 404 }
  }
}

const okJson = (body) => ({ ok: true, status: 200, json: async () => body })

test('me reports the signed-in account from both sources', async () => {
  const adapter = loadAdapter('./me.js', {
    fetch: router({
      '/api/auth/session': okJson(SESSION),
      '/backend-api/me': okJson({ id: 'acct-9', email: 'a@b.c', geoip_country: 'JP' }),
    }),
  })
  const r = await adapter({})
  assert.equal(r.signed_in, true)
  assert.equal(r.id, 'acct-9')
  assert.equal(r.country, 'JP')
  assert.equal(r.token_available, true)
})

test('me errors when signed out rather than returning a hollow record', async () => {
  const adapter = loadAdapter('./me.js', {
    // Signed out is HTTP 200 with `{}` — not an error status. Treating a
    // tokenless 200 as success is the bug this guards.
    fetch: router({ '/api/auth/session': okJson({}), '/backend-api/me': { ok: false, status: 401 } }),
  })
  const r = await adapter({})
  assert.match(r.error, /Not signed in/)
})

test('me distinguishes a live cookie jar whose token mint failed', async () => {
  const adapter = loadAdapter('./me.js', {
    fetch: router({
      '/api/auth/session': okJson({}),
      '/backend-api/me': okJson({ id: 'acct-9', email: 'a@b.c' }),
    }),
  })
  const r = await adapter({})
  assert.equal(r.signed_in, false)
  assert.equal(r.token_available, false)
  assert.equal(r.id, 'acct-9') // cookies still identify the account
})

test('conversations clamps limit and always orders by updated', async () => {
  const seen = []
  const adapter = loadAdapter('./conversations.js', {
    fetch: router(
      {
        '/api/auth/session': okJson(SESSION),
        '/backend-api/conversations': okJson({ total: 7, items: [{ id: 'c1', title: 'T', gizmo_id: null }] }),
      },
      seen,
    ),
  })
  for (const limit of ['-1', '0', 'nope', '500']) {
    const r = await adapter({ limit })
    assert.equal(r.conversations[0].url, 'https://chatgpt.com/c/c1')
    assert.equal(r.total, 7)
  }
  const limits = seen
    .filter((u) => u.startsWith('/backend-api/conversations'))
    .map((u) => new URL(u, 'https://chatgpt.com').searchParams.get('limit'))
  assert.deepEqual(limits, ['20', '20', '20', '100'])
  assert.ok(seen.every((u) => !u.startsWith('/backend-api/conv') || u.includes('order=updated')))
})

test('conversations filters by project client-side', async () => {
  const adapter = loadAdapter('./conversations.js', {
    fetch: router({
      '/api/auth/session': okJson(SESSION),
      '/backend-api/conversations': okJson({
        items: [
          { id: 'c1', gizmo_id: 'g-p-1' },
          { id: 'c2', gizmo_id: null },
        ],
      }),
    }),
  })
  const r = await adapter({ project: 'g-p-1' })
  assert.equal(r.count, 1)
  assert.equal(r.conversations[0].id, 'c1')
})

test('a 429 surfaces as a back-off instruction, not a generic HTTP error', async () => {
  const adapter = loadAdapter('./conversations.js', {
    fetch: router({
      '/api/auth/session': okJson(SESSION),
      '/backend-api/conversations': { ok: false, status: 429 },
    }),
  })
  const r = await adapter({})
  assert.equal(r.status, 429)
  assert.match(r.error, /rate-limited/i)
  // The hint is the whole point: it must tell the caller to stop, and why.
  assert.match(r.hint, /do not poll/i)
  assert.match(r.hint, /more than one/i)
})

test('adapters refuse before fetching when there is no token', async () => {
  let hitApi = false
  const adapter = loadAdapter('./projects.js', {
    fetch: router({
      '/api/auth/session': okJson({}),
      '/backend-api/': () => {
        hitApi = true
        return okJson({})
      },
    }),
  })
  const r = await adapter({})
  assert.match(r.error, /Not signed in/)
  assert.equal(hitApi, false)
})

test('projects unwraps the doubly nested gizmo envelope and skips malformed rows', async () => {
  const adapter = loadAdapter('./projects.js', {
    fetch: router({
      '/api/auth/session': okJson(SESSION),
      '/backend-api/gizmos/snorlax/sidebar': okJson({
        items: [
          { gizmo: { gizmo: { id: 'g-p-1', display: { name: 'Blog' } } } },
          { gizmo: { gizmo: { display: { name: 'no id' } } } }, // must be skipped
          { gizmo: null },
          {},
        ],
      }),
    }),
  })
  const r = await adapter({})
  assert.equal(r.count, 1)
  assert.equal(r.projects[0].name, 'Blog')
  assert.equal(r.projects[0].url, 'https://chatgpt.com/g/g-p-1/project')
})

test('projects --name matches exactly and lists the alternatives when it misses', async () => {
  const fetchStub = router({
    '/api/auth/session': okJson(SESSION),
    '/backend-api/gizmos/snorlax/sidebar': okJson({
      items: [
        { gizmo: { gizmo: { id: 'g-p-1', display: { name: 'Blog' } } } },
        { gizmo: { gizmo: { id: 'g-p-2', display: { name: 'blog' } } } },
      ],
    }),
  })
  const hit = await loadAdapter('./projects.js', { fetch: fetchStub })({ name: 'blog' })
  assert.equal(hit.projects[0].id, 'g-p-2') // case-sensitive, not the first row

  const miss = await loadAdapter('./projects.js', { fetch: fetchStub })({ name: 'Nope' })
  assert.match(miss.error, /No project named/)
  assert.match(miss.hint, /2 project/)
  assert.deepEqual(miss.projects, [])
})

test('the sidebar query keeps conversations_per_gizmo=0 so the response stays small', async () => {
  const seen = []
  await loadAdapter('./projects.js', {
    fetch: router(
      { '/api/auth/session': okJson(SESSION), '/backend-api/gizmos': okJson({ items: [] }) },
      seen,
    ),
  })({})
  assert.ok(seen.some((u) => u.includes('conversations_per_gizmo=0')))
})

test('cgptRateLimitedDialog detects the page dialog without any network call', async () => {
  // Exercised through a loaded adapter so the helper is evaluated exactly as
  // build_eval assembles it in the browser.
  const probe = new Function(
    'document',
    'fetch',
    `${HELPER}\n;return cgptRateLimitedDialog`,
  )(
    {
      querySelectorAll: () => [
        { textContent: "Too many requests — you're making requests too quickly." },
      ],
    },
    async () => ({ ok: false }),
  )
  assert.equal(probe(), true)
})
