// Ported from jackwener/OpenCLI v1.8.8, clis/bilibili/user-videos.js and the
// WBI signing / resolveUid helpers in clis/bilibili/utils.js
// (https://github.com/jackwener/opencli), Copyright 2025 jackwener, licensed
// under the Apache License 2.0 (http://www.apache.org/licenses/LICENSE-2.0);
// full text in bilibili/LICENSE-OpenCLI.
// Modified by chrome-use: rewritten as a chrome-use site adapter that runs in
// the logged-in www.bilibili.com tab, with the WBI signature (MD5) computed in
// the page instead of in Node; sends the dm_img_* fields the space page sends,
// and on risk control (-352) fetches fresh WBI keys and retries once; pages
// through more than 50 videos (--limit up to 1000); a name resolves only to an
// exact 昵称 match instead of the first search hit; counts Bilibili leaves out
// come back as null instead of 0; returns {mid, total, videos} and failures as
// {error, hint}.
/* @meta
{
  "name": "bilibili/user-videos",
  "description": "A Bilibili user's uploads (投稿) with plays, likes, comments and danmaku, newest first by default. Takes a UID, a space.bilibili.com URL or an exact 昵称",
  "domain": "www.bilibili.com",
  "timeout": 120,
  "args": {
    "uid": {"required": true, "description": "The user's UID (mid), their space.bilibili.com URL, or their exact 昵称"},
    "limit": {"required": false, "description": "How many videos (default 20, at most 1000; more than 50 pages through the list)"},
    "order": {"required": false, "description": "pubdate (default, newest first) | click (most played) | stow (most favorited)"},
    "page": {"required": false, "description": "Page to start from, 1-based (default 1)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "chrome-use site bilibili/user-videos 53579383"
}
*/

async function(args) {
  args = args || {}
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const API = 'https://api.bilibili.com'

  // ---- arguments -------------------------------------------------------
  const raw = String(args.uid == null ? '' : args.uid).trim()
  if (!raw) return { error: 'Missing argument: uid', hint: 'Pass a UID, e.g. chrome-use site bilibili/user-videos 53579383' }
  const ORDERS = ['pubdate', 'click', 'stow']
  const order = String(args.order || 'pubdate').trim()
  if (!ORDERS.includes(order)) return { error: 'Unknown order: ' + order, hint: 'Use one of ' + ORDERS.join(', ') }
  const intArg = (v, dflt) => {
    const n = Number.parseInt(String(v == null ? '' : v), 10)
    return Number.isFinite(n) && n >= 1 ? n : dflt
  }
  const limit = Math.min(intArg(args.limit, 20), 1000)
  const startPage = intArg(args.page, 1)

  // ---- MD5 for the WBI signature (the page has no MD5 of its own) --------
  const md5 = (str) => {
    const bytes = Array.from(new TextEncoder().encode(str))
    const len = bytes.length
    bytes.push(0x80)
    while (bytes.length % 64 !== 56) bytes.push(0)
    const bitLen = len * 8
    for (let i = 0; i < 8; i += 1) bytes.push(i < 4 ? (bitLen >>> (8 * i)) & 0xff : i === 4 ? Math.floor(bitLen / 0x100000000) & 0xff : 0)
    const K = []
    for (let i = 0; i < 64; i += 1) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0
    const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476
    for (let off = 0; off < bytes.length; off += 64) {
      const M = []
      for (let i = 0; i < 16; i += 1) {
        const j = off + i * 4
        M[i] = (bytes[j] | (bytes[j + 1] << 8) | (bytes[j + 2] << 16) | (bytes[j + 3] << 24)) >>> 0
      }
      let A = a0, B = b0, C = c0, Dd = d0
      for (let i = 0; i < 64; i += 1) {
        let F, g
        if (i < 16) { F = (B & C) | (~B & Dd); g = i }
        else if (i < 32) { F = (Dd & B) | (~Dd & C); g = (5 * i + 1) % 16 }
        else if (i < 48) { F = B ^ C ^ Dd; g = (3 * i + 5) % 16 }
        else { F = C ^ (B | ~Dd); g = (7 * i) % 16 }
        const s = S[(i >> 4) * 4 + (i % 4)]
        const sum = (A + F + K[i] + M[g]) >>> 0
        A = Dd; Dd = C; C = B
        B = (B + ((sum << s) | (sum >>> (32 - s)))) >>> 0
      }
      a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + Dd) >>> 0
    }
    return [a0, b0, c0, d0].map((w) => [0, 1, 2, 3].map((k) => ((w >>> (8 * k)) & 0xff).toString(16).padStart(2, '0')).join('')).join('')
  }

  // ---- WBI signing -------------------------------------------------------
  const MIXIN = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52]
  const getJson = async (url) => {
    let res
    try { res = await fetch(url, { credentials: 'include' }) } catch (e) { return { code: -1, message: 'Network error: ' + (e && e.message || e) } }
    const text = await res.text()
    // Risk control can answer with an HTML page (HTTP 412) instead of JSON.
    try { return JSON.parse(text) } catch (e) { return { code: res.status === 412 ? -412 : -1, message: 'Non-JSON response (HTTP ' + res.status + ')' } }
  }
  let mixinKey = null
  const loadKeys = async () => {
    // nav answers code -101 when signed out but still carries wbi_img.
    const nav = await getJson(API + '/x/web-interface/nav')
    const img = (nav && nav.data && nav.data.wbi_img) || {}
    const stem = (u) => String(u || '').split('/').pop().split('.')[0]
    const both = stem(img.img_url) + stem(img.sub_url)
    if (both.length < 64) return false
    mixinKey = MIXIN.map((i) => both[i] || '').join('').slice(0, 32)
    return true
  }
  const sign = (params) => {
    const all = { ...params, wts: String(Math.floor(Date.now() / 1000)) }
    const sorted = {}
    for (const k of Object.keys(all).sort()) sorted[k] = String(all[k]).replace(/[!'()*]/g, '')
    // Bilibili checks the signature over %20, not URLSearchParams' +.
    const query = new URLSearchParams(sorted).toString().replace(/\+/g, '%20')
    return query + '&w_rid=' + md5(query + mixinKey)
  }
  // The space page sends these with arc/search; without them -352 is likelier.
  const b64 = (s) => { try { return btoa(s).slice(0, -2) } catch (e) { return '' } }
  let glVersion = 'WebGL 1.0 (OpenGL ES 2.0 Chromium)'
  let glRenderer = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)'
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info')
    if (gl) glVersion = gl.getParameter(gl.VERSION) || glVersion
    if (gl && dbg) glRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || glRenderer
  } catch (e) { /* keep the defaults */ }
  const dm = {
    dm_img_list: '[]',
    dm_img_str: b64(glVersion),
    dm_cover_img_str: b64(glRenderer),
    dm_img_inter: '{"ds":[],"wh":[0,0,0],"of":[0,0,0]}',
  }
  const signedGet = async (path, params) => {
    if (!mixinKey && !(await loadKeys())) return { code: -1, message: 'Could not read the WBI keys from /x/web-interface/nav' }
    let d = await getJson(API + path + '?' + sign(params))
    if (d && (d.code === -352 || d.code === -412)) {
      // Risk control: fresh keys, a pause, one more try.
      await sleep(1500)
      await loadKeys()
      d = await getJson(API + path + '?' + sign(params))
    }
    return d
  }
  const riskHint = 'Bilibili risk control (风控) refused the request. Open www.bilibili.com in this browser, pass any 验证 it shows, wait a few minutes, then run once more'

  // ---- UID: a number, a space URL, or an exact 昵称 -----------------------
  let mid = null
  let resolvedFrom = null
  if (/^\d+$/.test(raw)) {
    mid = raw
  } else {
    let u = null
    try { u = new URL(raw) } catch (e) { u = null }
    if (u) {
      const m = u.protocol === 'https:' && u.hostname === 'space.bilibili.com' && u.pathname.match(/^\/(\d+)/)
      if (!m) return { error: 'Not a space.bilibili.com URL: ' + raw, hint: 'Use https://space.bilibili.com/<uid>, the UID, or the exact 昵称' }
      mid = m[1]
    } else {
      const name = raw.replace(/^@/, '')
      const d = await signedGet('/x/web-interface/wbi/search/type', { search_type: 'bili_user', keyword: name })
      if (!d || d.code !== 0) return { error: 'User search failed: ' + ((d && d.message) || 'unknown') + ' (' + (d && d.code) + ')', hint: d && (d.code === -352 || d.code === -412) ? riskHint : 'Pass the UID instead' }
      const results = Array.isArray(d.data && d.data.result) ? d.data.result : []
      const clean = (s) => String(s || '').replace(/<[^>]*>/g, '').trim()
      const exact = results.filter((r) => r && clean(r.uname) === name)
      if (exact.length !== 1) {
        return {
          error: exact.length ? 'More than one user is named ' + name : 'No user is named exactly ' + name,
          candidates: results.slice(0, 5).map((r) => ({ mid: String(r.mid), uname: clean(r.uname), fans: r.fans == null ? null : r.fans })),
          hint: 'Pass the UID of the one you mean',
        }
      }
      mid = String(exact[0].mid)
      resolvedFrom = name
    }
  }

  // ---- the uploads, page by page ------------------------------------------
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
  const ps = Math.min(limit, 50)
  const videos = []
  let total = null
  for (let pn = startPage; videos.length < limit; pn += 1) {
    if (pn > startPage) await sleep(600)
    const d = await signedGet('/x/space/wbi/arc/search', {
      mid, ps, pn, order, tid: 0, keyword: '', platform: 'web', web_location: 1550101, order_avoided: 'true', ...dm,
    })
    if (!d || d.code !== 0) {
      const code = d && d.code
      const out = {
        error: 'arc/search failed: ' + ((d && d.message) || 'unknown') + ' (' + code + ')',
        hint: code === -352 || code === -412 ? riskHint : code === -404 ? 'No such user: ' + mid : 'Check that www.bilibili.com loads in this browser',
      }
      // Pages already read are not thrown away.
      if (videos.length) { out.partial = true; out.mid = mid; out.total = total; out.count = videos.length; out.videos = videos }
      return out
    }
    const list = (d.data && d.data.list) || {}
    const vlist = Array.isArray(list.vlist) ? list.vlist : []
    if (d.data && d.data.page && total == null) total = num(d.data.page.count)
    for (const item of vlist) {
      if (videos.length >= limit) break
      const created = num(item.created)
      videos.push({
        rank: (startPage - 1) * ps + videos.length + 1,
        bvid: item.bvid || null,
        aid: item.aid == null ? null : String(item.aid),
        title: item.title || '',
        plays: num(item.play),
        likes: num(item.like),
        comments: num(item.comment),
        danmaku: num(item.video_review),
        length: item.length || null,
        created: created == null ? null : new Date(created * 1000).toISOString(),
        date: created == null ? '' : new Date(created * 1000).toISOString().slice(0, 10),
        url: item.bvid ? 'https://www.bilibili.com/video/' + item.bvid : '',
      })
    }
    if (vlist.length < ps || (total != null && pn * ps >= total)) break
  }

  const out = { mid, order, total, count: videos.length, videos }
  if (resolvedFrom) out.resolved_from = resolvedFrom
  return out
}
