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
      '/backend-api/me': okJson({ id: 'acct-9', email: 'a@b.c', country: 'JP' }),
    }),
  })
  const r = await adapter({})
  assert.equal(r.signed_in, true)
  assert.equal(r.id, 'acct-9')
  // `country`, not `geoip_country` — the latter is absent from /backend-api/me.
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
        '/backend-api/conversations': okJson({
          total: 4, // deliberately not account-wide; must not be exposed
          items: [{ id: 'c1', title: 'T', gizmo_id: null, snippet: 'hi', is_starred: true }],
        }),
      },
      seen,
    ),
  })
  for (const limit of ['-1', '0', 'nope', '500']) {
    const r = await adapter({ limit })
    assert.equal(r.conversations[0].url, 'https://chatgpt.com/c/c1')
    assert.equal(r.conversations[0].snippet, 'hi')
    assert.equal(r.conversations[0].starred, true)
    // The server's `total` is NOT account-wide (observed total:4 against ~28
    // conversations), so exposing it would make callers stop paging early.
    assert.ok(!('total' in r), 'total must not be exposed')
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

// ---- chatgpt/models -------------------------------------------------------

const MODELS = {
  default_model_slug: 'gpt-5-6',
  model_picker_version: 2,
  categories: [
    { category: 'pro', human_category_name: 'Pro', human_category_short_name: '6 Pro',
      default_model: 'gpt-6-pro', subscription_level: 'pro', tagline: 'Research-grade intelligence' },
  ],
  models: [
    { slug: 'gpt-5-6', title: 'GPT-5.6', description: 'd', max_tokens: 137000, tags: ['t'] },
    { slug: 'gpt-6-pro', title: 'GPT-6 Pro', description: 'd', max_tokens: 196000, tags: [],
      reasoning_type: 'pro', configurable_thinking_effort: true,
      thinking_efforts: [{ thinking_effort: 'standard', full_label: 'Thinking', description: 'balanced' }] },
  ],
}

test('models lists slugs and the account default', async () => {
  const adapter = loadAdapter('./models.js', {
    fetch: router({ '/api/auth/session': okJson(SESSION), '/backend-api/models': okJson(MODELS) }),
  })
  const r = await adapter({})
  assert.equal(r.default, 'gpt-5-6')
  assert.equal(r.picker_version, 2)
  assert.equal(r.count, 2)
  assert.deepEqual(r.models.map((m) => m.slug), ['gpt-5-6', 'gpt-6-pro'])
  // Categories come from the API's snake_case keys, not the localStorage cache's camelCase.
  assert.equal(r.categories[0].short_name, '6 Pro')
})

test('models filters on slug or title, case-insensitively', async () => {
  const adapter = loadAdapter('./models.js', {
    fetch: router({ '/api/auth/session': okJson(SESSION), '/backend-api/models': okJson(MODELS) }),
  })
  const r = await adapter({ slug: 'PRO' })
  assert.equal(r.count, 1)
  assert.equal(r.total, 2)
  assert.equal(r.models[0].slug, 'gpt-6-pro')
  // `reasoning_type: pro` is the flag that says "cannot use Apps/MCP connectors".
  assert.equal(r.models[0].reasoning_type, 'pro')
})

test('models keeps effort lists only when asked', async () => {
  const mk = () => loadAdapter('./models.js', {
    fetch: router({ '/api/auth/session': okJson(SESSION), '/backend-api/models': okJson(MODELS) }),
  })
  const lean = await mk()({ slug: 'gpt-6-pro' })
  assert.equal(lean.models[0].thinking_efforts, undefined)
  assert.equal(lean.models[0].thinking_effort_count, 1)
  const full = await mk()({ slug: 'gpt-6-pro', efforts: true })
  assert.equal(full.models[0].thinking_efforts[0].effort, 'standard')
})

// ---- chatgpt/conversation -------------------------------------------------

// Shaped after a real payload: a synthetic root with no message, a weight-0
// tool placeholder, a reasoning recap, and the answer — plus an ABANDONED
// branch that a naive Object.values() walk would splice into the transcript.
const CONVO = {
  conversation_id: 'c-1',
  title: 'Reply M PRO',
  create_time: 1, update_time: 2,
  gizmo_id: 'g-p-x', default_model_slug: 'gpt-6-pro',
  is_archived: false, is_starred: false, is_read_only: false, async_status: null,
  current_node: 'n4',
  mapping: {
    root: { id: 'root', parent: null, children: ['n1'] },
    n1: { id: 'n1', parent: 'root', children: ['n2', 'n3', 'dead'],
          message: { author: { role: 'user' }, weight: 1, create_time: 1,
                     content: { content_type: 'text', parts: ['Reply with exactly: M-PRO'] } } },
    n2: { id: 'n2', parent: 'n1', children: [],
          message: { author: { role: 'tool' }, weight: 0,
                     content: { content_type: 'text', parts: [''] } } },
    n3: { id: 'n3', parent: 'n1', children: ['n4'],
          message: { author: { role: 'assistant' }, weight: 1, end_turn: true,
                     content: { content_type: 'reasoning_recap', content: 'Worked for 18s' } } },
    n4: { id: 'n4', parent: 'n3', children: [],
          message: { author: { role: 'assistant' }, weight: 1, end_turn: true, create_time: 3,
                     metadata: { model_slug: 'gpt-6-pro' },
                     content: { content_type: 'text', parts: ['M-PRO'] } } },
    dead: { id: 'dead', parent: 'n1', children: [],
            message: { author: { role: 'assistant' }, weight: 1, end_turn: true,
                       content: { content_type: 'text', parts: ['ABANDONED DRAFT'] } } },
  },
}

const convoAdapter = () => loadAdapter('./conversation.js', {
  fetch: router({ '/api/auth/session': okJson(SESSION), '/backend-api/conversation/': okJson(CONVO) }),
})

test('conversation follows the live branch and drops the abandoned one', async () => {
  const r = await convoAdapter()({ id: 'c-1' })
  const texts = r.messages.map((m) => m.text)
  assert.deepEqual(texts, ['Reply with exactly: M-PRO', 'M-PRO'])
  // The regenerated sibling must never appear — that is the whole reason we
  // walk current_node's parent chain instead of the mapping's values.
  assert.equal(texts.includes('ABANDONED DRAFT'), false)
})

test('conversation hides chrome by default and reveals it with all', async () => {
  const lean = await convoAdapter()({ id: 'c-1' })
  assert.equal(lean.messages.some((m) => m.content_type === 'reasoning_recap'), false)
  // The weight-0 tool placeholder is hidden in BOTH modes: weight 0 means the
  // account itself does not see it.
  assert.equal(lean.messages.some((m) => m.role === 'tool'), false)
  const full = await convoAdapter()({ id: 'c-1', all: true })
  assert.equal(full.messages.some((m) => m.content_type === 'reasoning_recap'), true)
})

test('conversation reports the finished answer as final', async () => {
  const r = await convoAdapter()({ id: 'c-1' })
  assert.equal(r.final.text, 'M-PRO')
  assert.equal(r.final.end_turn, true)
  assert.equal(r.final.model, 'gpt-6-pro')
  assert.equal(r.model, 'gpt-6-pro')
  assert.equal(r.project, 'g-p-x')
})

test('conversation leaves final null while a turn is unfinished', async () => {
  const running = JSON.parse(JSON.stringify(CONVO))
  running.mapping.n4.message.end_turn = false
  running.async_status = 1
  const adapter = loadAdapter('./conversation.js', {
    fetch: router({ '/api/auth/session': okJson(SESSION), '/backend-api/conversation/': okJson(running) }),
  })
  const r = await adapter({ id: 'c-1' })
  // The text is on screen but the turn has not closed. Reporting it as the
  // answer is exactly the mistake DOM-quiescence scraping makes.
  assert.equal(r.final, null)
  assert.equal(r.async_status, 1)
})

test('conversation accepts a pasted URL in either form', async () => {
  const seen = []
  const adapter = loadAdapter('./conversation.js', {
    fetch: router({ '/api/auth/session': okJson(SESSION), '/backend-api/conversation/': okJson(CONVO) }, seen),
  })
  await adapter({ id: 'https://chatgpt.com/g/g-p-abc/c/6aa20b3f-c6fc-83e8-9007-e1e3d3a8eb3d' })
  assert.equal(
    seen.some((u) => u === '/backend-api/conversation/6aa20b3f-c6fc-83e8-9007-e1e3d3a8eb3d'),
    true,
  )
})

test('conversation rejects a missing id instead of fetching nonsense', async () => {
  const r = await convoAdapter()({})
  assert.match(r.error, /Missing conversation id/)
})

// Guard against the packaging bug this pack was one commit away from shipping:
// `models.js` and `conversation.js` were written, tested and merged while
// install.sh's PACKS list still named only the first three adapters, so the
// legacy installer would have fetched a chatgpt pack missing half of it — and
// silently, since a pack with fewer adapters looks exactly like a pack.
// The twitter pack had a sibling of this bug (chrome-use-sites#4): nothing
// fetched the helper its adapters call, so they threw "findGraphQLQueryId is
// not defined" — see the guard in twitter/adapters.test.js.
test('install.sh ships every chatgpt adapter in this directory', () => {
  const install = fs.readFileSync(new URL('../install.sh', import.meta.url), 'utf8')
  const onDisk = fs
    .readdirSync(new URL('.', import.meta.url))
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
    .sort()

  const missing = onDisk.filter((f) => !install.includes('chatgpt/' + f))
  assert.deepEqual(
    missing,
    [],
    'these adapters exist but install.sh will not fetch them: ' + missing.join(', '),
  )

  // And the reverse: a PACKS entry pointing at a file that no longer exists
  // makes the installer 404 mid-run.
  const listed = [...install.matchAll(/chatgpt\/([\w.-]+\.js)/g)].map((m) => m[1])
  const stale = listed.filter((f) => !onDisk.includes(f))
  assert.deepEqual(stale, [], 'install.sh lists files that do not exist: ' + stale.join(', '))
})
