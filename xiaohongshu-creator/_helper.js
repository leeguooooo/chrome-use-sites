// Shared plumbing for the `xiaohongshu-creator/*` adapters.
//
// Every creator.xiaohongshu.com API call carries X-s / X-t / X-S-Common
// signature headers. The page computes them in a request interceptor on its
// own HTTP client (it calls window._webmsxyw). These adapters never sign
// anything themselves: they find that client in the page's webpack registry
// and call it, so each request is built, signed and sent exactly the way the
// creator center sends it when you click around.
//
// The client is located through a module that calls it with a known endpoint
// key (`.get("NOTE_STATICS"` and friends). Export names are minified and change
// between builds; the endpoint keys are string literals and have not.

const XHSC_CLIENT_KEYS = ['NOTE_STATICS', 'USER_POSTED_NOTES', 'QUERY_ACCOUNT_DATA', 'PERSONAL_INFO']

function xhscSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** The page's webpack require, or null before the app bundle has loaded. */
function xhscWebpackRequire() {
  const chunks = window.webpackChunkugc
  if (!chunks || typeof chunks.push !== 'function') return null
  let req = null
  chunks.push([[Symbol('chrome-use-xhsc')], {}, (r) => { req = r }])
  return req && req.m ? req : null
}

function xhscIsClient(c) {
  return !!(c && typeof c.get === 'function' && typeof c.post === 'function' && c.interceptors)
}

/** The page's signed HTTP client, or null if it cannot be found. */
function xhscFindClient() {
  if (xhscIsClient(window.__chromeUseXhscClient)) return window.__chromeUseXhscClient
  const req = xhscWebpackRequire()
  if (!req) return null
  for (const id of Object.keys(req.m)) {
    let src
    try { src = String(req.m[id]) } catch (e) { continue }
    for (const key of XHSC_CLIENT_KEYS) {
      if (!src.includes('.get("' + key + '"')) continue
      // `var a=t(11237); … a.LV.get("NOTE_STATICS", …)` → module 11237, export LV.
      const re = new RegExp('(\\w+)=\\w\\((\\d+)\\)[^]*?\\1\\.(\\w+)\\.get\\("' + key + '"')
      const m = src.match(re)
      if (!m) continue
      let client = null
      try { client = req(Number(m[2]))[m[3]] } catch (e) { client = null }
      if (xhscIsClient(client)) {
        window.__chromeUseXhscClient = client
        return client
      }
    }
  }
  return null
}

/** The signed-in creator from the page's own Vuex store (no request), or null. */
function xhscSessionUser() {
  try {
    const app = document.querySelector('#app')
    const store = app && app.__vue_app__ && app.__vue_app__.config.globalProperties.$store
    const info = store && store.state && store.state.Auth && store.state.Auth.userInfo
    return info && info.userId ? info : null
  } catch (e) {
    return null
  }
}

/**
 * A wall-clock budget for one adapter run. chrome-use's relay abandons an
 * evaluation after ~8 s ("relay timeout after 8000ms"), and a creator API call
 * has been measured taking 10 s. Every wait and request draws on this budget
 * so the adapter returns its own clear error (or a partial result) first.
 */
function xhscBudget(ms) {
  const end = Date.now() + (ms == null ? 7000 : ms)
  return { left: () => end - Date.now() }
}

/**
 * Wait (bounded) for the creator app to boot, then return {client, user}, or
 * {error, hint}. The page loads its user asynchronously after navigation, so a
 * single immediate read would report "not signed in" on a cold tab.
 */
async function xhscReady(budget) {
  const deadline = Date.now() + Math.min(4000, budget ? budget.left() - 2000 : 4000)
  let client = null
  let user = null
  for (;;) {
    client = client || xhscFindClient()
    user = user || xhscSessionUser()
    if (client && user) return { client, user }
    if (Date.now() >= deadline) break
    await xhscSleep(250)
  }
  if (!user) {
    return {
      error: 'Not signed in to creator.xiaohongshu.com',
      hint: 'Open https://creator.xiaohongshu.com in this browser and log in, then retry.',
    }
  }
  return {
    error: 'Cannot find the creator page HTTP client',
    hint: 'creator.xiaohongshu.com changed its bundle; these adapters need updating.',
  }
}

/**
 * GET an endpoint through the page's client, within `budget`. Resolves to
 * {ok:true, data} or {ok:false, error, hint, status}. The client throws on
 * HTTP errors and on bodies with `success:false`; code -101 is its "logged
 * out" signal.
 */
async function xhscGet(client, path, opts, budget) {
  const ms = budget ? budget.left() : 6000
  const slow = {
    ok: false,
    status: 0,
    timeout: true,
    error: 'Xiaohongshu did not answer ' + path + ' in time',
    hint: 'The creator API is slow right now. Retry once later; do not loop.',
  }
  if (ms < 300) return slow
  // A fresh config per call: the client writes the resolved URL back into the
  // object it is given, so parallel calls sharing one options object all went
  // to whichever path was written last.
  const config = Object.assign({}, opts)
  if (config.params) config.params = Object.assign({}, config.params)
  let timer
  try {
    const data = await Promise.race([
      client.get(path, config),
      new Promise((resolve) => { timer = setTimeout(() => resolve(slow), ms) }),
    ])
    return data === slow ? slow : { ok: true, data }
  } catch (e) {
    const status = (e && (e.status || e.statusCode)) || 0
    const body = (e && (e.data || e.response)) || {}
    const code = body.code != null ? body.code : body.result
    if (status === 401 || code === -101) {
      return {
        ok: false,
        status: 401,
        error: 'creator.xiaohongshu.com rejected the session',
        hint: 'Log in again at https://creator.xiaohongshu.com, then retry.',
      }
    }
    // 461 is what the XHS web API answers when it wants a captcha solved.
    if (status === 429 || status === 461) {
      return {
        ok: false,
        status,
        error: 'Xiaohongshu throttled or challenged this account (HTTP ' + status + ')',
        hint: 'Stop and back off; do not retry in a loop. Open the creator center by hand to clear any captcha.',
      }
    }
    const msg = (body && body.msg) || (body && body.message) || (e && e.message) || String(e)
    return { ok: false, status, error: 'Request to ' + path + ' failed: ' + msg }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * A metric as a number, or null when Xiaohongshu has no value for it. The data
 * center reports "not computed yet" as -1 (fresh notes show -1 for most rates
 * for a day or two); that is missing data, not zero.
 */
function xhscNum(v) {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n === -1) return null
  return n
}

/** Clamp a user-supplied count into [1, max], falling back to `dflt`. */
function xhscCount(raw, dflt, max) {
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) return dflt
  return Math.min(n, max)
}

/** Epoch ms → ISO 8601 in China time, which is what the creator center displays. */
function xhscIsoFromMs(ms) {
  const n = xhscNum(ms)
  if (!n) return null
  return new Date(n + 8 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, '+08:00')
}

/** Epoch ms of a China-time midnight → YYYY-MM-DD. */
function xhscDateFromMs(ms) {
  const iso = xhscIsoFromMs(ms)
  return iso ? iso.slice(0, 10) : null
}

/** Accept a bare note id or any www.xiaohongshu.com /explore|/discovery/item URL. */
function xhscParseNoteId(input) {
  const raw = String(input == null ? '' : input).trim()
  const m = raw.match(/(?:explore|discovery\/item|search_result)\/([0-9a-f]{24})/i)
  if (m) return m[1].toLowerCase()
  if (/^[0-9a-f]{24}$/i.test(raw)) return raw.toLowerCase()
  return null
}

function xhscNoteUrl(id, xsecToken, xsecSource) {
  const base = 'https://www.xiaohongshu.com/explore/' + id
  if (!xsecToken) return base
  return base + '?xsec_token=' + encodeURIComponent(xsecToken) +
    '&xsec_source=' + encodeURIComponent(xsecSource || 'pc_creatormng')
}
