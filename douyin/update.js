// Ported from jackwener/OpenCLI v1.8.8, clis/douyin/update.js and
// clis/douyin/_shared/timing.js (https://github.com/jackwener/opencli),
// Copyright 2025 jackwener, licensed under the Apache License 2.0
// (http://www.apache.org/licenses/LICENSE-2.0); full text in
// douyin/LICENSE-OpenCLI.
// Modified by chrome-use: rewritten as a chrome-use site adapter that runs in
// the logged-in creator.douyin.com tab; the id is checked to be digits and
// sent as a string; responses are parsed so 64-bit ids stay exact; failures
// come back as {error, hint} and say which of the two updates already ran.
/* @meta
{
  "name": "douyin/update",
  "description": "Change one of the signed-in account's own Douyin works: its scheduled publish time (--reschedule) and/or its text (--caption), through the creator center's own update calls",
  "domain": "creator.douyin.com",
  "args": {
    "aweme_id": {"required": true, "description": "The work's id (aweme_id, digits only), e.g. from douyin-creator/works"},
    "reschedule": {"required": false, "description": "New publish time for a scheduled work: ISO 8601 (2026-10-20T20:00:00+08:00) or Unix seconds. Must be 2 hours to 14 days from now"},
    "caption": {"required": false, "description": "New text (正文) for the work"}
  },
  "capabilities": ["network"],
  "readOnly": false,
  "example": "chrome-use site douyin/update 7694857245896576275 --caption @caption.txt"
}
*/

async function(args) {
  args = args || {}
  const BASE = 'https://creator.douyin.com'
  const MIN_OFFSET = 7200 // 2 hours
  const MAX_OFFSET = 14 * 86400 // 14 days

  const awemeId = String(args.aweme_id == null ? '' : args.aweme_id).trim()
  if (!awemeId) return { error: 'Missing argument: aweme_id', hint: 'Pass the work id, e.g. chrome-use site douyin/update 7694857245896576275 --caption "..."' }
  if (!/^\d+$/.test(awemeId)) return { error: 'aweme_id must be a numeric id, got ' + JSON.stringify(awemeId), hint: 'List ids with chrome-use site douyin-creator/works' }
  const reschedule = String(args.reschedule == null ? '' : args.reschedule).trim()
  const caption = args.caption == null ? '' : String(args.caption)
  if (!reschedule && !caption) return { error: 'Nothing to update', hint: 'Pass --reschedule <time> and/or --caption <text>' }

  let publishTime = null
  if (reschedule) {
    publishTime = /^\d+$/.test(reschedule) ? Number(reschedule) : Math.floor(new Date(reschedule).getTime() / 1000)
    if (!Number.isFinite(publishTime)) return { error: 'Bad --reschedule: ' + JSON.stringify(reschedule), hint: 'Use ISO 8601 (2026-10-20T20:00:00+08:00) or Unix seconds' }
    const now = Math.floor(Date.now() / 1000)
    if (publishTime < now + MIN_OFFSET) return { error: 'The new publish time must be at least 2 hours from now', publish_time: publishTime }
    if (publishTime > now + MAX_OFFSET) return { error: 'The new publish time must be at most 14 days from now', publish_time: publishTime }
  }

  // Douyin sends 64-bit ids as bare JSON numbers, which JSON.parse rounds.
  // Quote every integer that is not a safe JS integer before parsing.
  function quoteUnsafeIntegers(text) {
    const src = String(text)
    let out = ''
    let i = 0
    let last = 0
    while (i < src.length) {
      const c = src[i]
      if (c === '"') {
        i += 1
        while (i < src.length && src[i] !== '"') i += src[i] === '\\' ? 2 : 1
        i += 1
        continue
      }
      if (c === '-' || (c >= '0' && c <= '9')) {
        const start = i
        i += 1
        while (i < src.length && /[0-9.eE+-]/.test(src[i])) i += 1
        const token = src.slice(start, i)
        if (/^-?\d+$/.test(token) && !Number.isSafeInteger(Number(token))) {
          out += src.slice(last, start) + '"' + token + '"'
          last = i
        }
        continue
      }
      i += 1
    }
    return out + src.slice(last)
  }

  const authLike = (code, msg) => code === 401 || code === 403 || /login|cookie|auth|captcha|verify|forbidden|permission|登录|登陆|权限|验证|验证码/i.test(String(msg || ''))

  // POST a JSON body from the page (cookies and signing come with it).
  async function post(path, body) {
    let res
    let text
    try {
      res = await fetch(BASE + path, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      text = await res.text()
    } catch (e) {
      return { ok: false, error: 'Network error: ' + String((e && e.message) || e) }
    }
    if (!String(text || '').trim()) {
      return res.ok ? { ok: false, error: 'Empty response from ' + path, hint: 'The endpoint may have been retired or may now need signed parameters' } : { ok: false, error: 'HTTP ' + res.status + ' from ' + path }
    }
    let d
    try {
      d = JSON.parse(quoteUnsafeIntegers(text))
    } catch (e) {
      return { ok: false, error: 'Unreadable response from ' + path + ' (HTTP ' + res.status + ')' }
    }
    if (!d || typeof d !== 'object' || Array.isArray(d)) return { ok: false, error: 'Malformed response from ' + path }
    if ('status_code' in d && d.status_code !== 0) {
      const msg = d.status_msg || d.message || 'unknown error'
      return { ok: false, error: 'Douyin API error ' + d.status_code + ' at ' + path + ': ' + msg, loginRequired: authLike(d.status_code, msg) || undefined }
    }
    return { ok: true, data: d }
  }

  const updated = []
  const fail = (r) => ({
    error: r.error,
    hint: r.loginRequired ? 'Open https://creator.douyin.com and sign in, then retry' : r.hint || (updated.length ? 'Already updated: ' + updated.join(', ') + '; the rest was not applied' : 'Nothing was changed'),
    updated,
    aweme_id: awemeId,
  })
  if (publishTime != null) {
    const r = await post('/web/api/media/update/timer/?aid=1128', { aweme_id: awemeId, publish_time: publishTime })
    if (!r.ok) return fail(r)
    updated.push('reschedule')
  }
  if (caption) {
    const r = await post('/web/api/media/update/desc/?aid=1128', { aweme_id: awemeId, desc: caption })
    if (!r.ok) return fail(r)
    updated.push('caption')
  }
  return { ok: true, status: 'updated', aweme_id: awemeId, updated, publish_time: publishTime }
}
