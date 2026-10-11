// Ported from jackwener/OpenCLI v1.8.8, clis/bilibili/creator-stats.js and
// parseBvidOrVideoUrl in clis/bilibili/utils.js
// (https://github.com/jackwener/opencli), Copyright 2025 jackwener, licensed
// under the Apache License 2.0 (http://www.apache.org/licenses/LICENSE-2.0);
// full text in bilibili/LICENSE-OpenCLI.
// Modified by chrome-use: rewritten as a chrome-use site adapter that runs in
// the logged-in member.bilibili.com tab; one malformed row elsewhere in the
// list, or one metric Bilibili leaves out, no longer fails the whole command
// (the missing metric is null and named in `missing`); a video outside the
// latest 100 creator-center rows falls back to its public counts
// (source: "public") instead of an error; returns one object
// {bvid, title, source, values, metrics, missing} and failures as {error, hint}.
/* @meta
{
  "name": "bilibili/creator-stats",
  "description": "Creator-center (创作中心) numbers for one of the signed-in account's videos: plays, likes, comments, danmaku, favorites, coins, shares, new followers, completion and click-through rates",
  "domain": "member.bilibili.com",
  "timeout": 60,
  "args": {
    "bvid": {"required": true, "description": "The video's BV id (case-sensitive, e.g. BV1xx411c7mD) or its https://www.bilibili.com/video/BV… URL"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "chrome-use site bilibili/creator-stats BV1xx411c7mD"
}
*/

async function(args) {
  args = args || {}

  // ---- the BV id ----------------------------------------------------------
  const BV = /^BV[0-9A-Za-z]{10}$/
  const raw = String(args.bvid == null ? '' : args.bvid).trim()
  if (!raw) return { error: 'Missing argument: bvid', hint: 'Pass a BV id, e.g. chrome-use site bilibili/creator-stats BV1xx411c7mD' }
  let bvid = null
  if (BV.test(raw)) {
    bvid = raw
  } else {
    let u = null
    try { u = new URL(raw) } catch (e) { u = null }
    const hosts = ['bilibili.com', 'www.bilibili.com', 'm.bilibili.com']
    const m = u && u.protocol === 'https:' && hosts.includes(u.hostname) && !u.username && !u.password && !u.port
      && u.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/)
    if (!m) return { error: 'Not a BV id or bilibili.com video URL: ' + raw, hint: 'Use the exact BV id (BV + 10 characters, case-sensitive) or https://www.bilibili.com/video/<BV id>' }
    bvid = m[1]
  }

  const getJson = async (url) => {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 15000) : null
    try {
      const res = await fetch(url, { credentials: 'include', signal: ctrl ? ctrl.signal : undefined })
      const text = await res.text()
      try { return JSON.parse(text) } catch (e) { return { code: res.status === 401 || res.status === 403 ? -101 : -1, message: 'Non-JSON response (HTTP ' + res.status + ')' } }
    } catch (e) {
      return { code: -1, message: /abort/i.test(String(e && (e.name || e.message))) ? 'Timed out after 15 s' : 'Network error: ' + (e && e.message || e) }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  const isAuth = (d) => d && (d.code === -101 || d.code === -111 || /登录|not logged in|login required/i.test(String(d.message || d.msg || '')))
  const loginHint = 'Sign in to member.bilibili.com (创作中心) in this browser, then run again'

  // ---- the creator center's comparison list (the account's latest 100) ---
  // Rates arrive in basis points (100 = 1 %).
  const METRICS = [
    ['playCount', 'play', 'count'],
    ['likeCount', 'like', 'count'],
    ['commentCount', 'comment', 'count'],
    ['danmakuCount', 'dm', 'count'],
    ['favoriteCount', 'fav', 'count'],
    ['coinCount', 'coin', 'count'],
    ['shareCount', 'share', 'count'],
    ['newFollowerCount', 'total_new_attention_cnt', 'count'],
    ['durationSeconds', 'duration', 'seconds', 'target'],
    ['completionPct', 'full_play_ratio', 'percent'],
    ['activeFollowerViewPct', 'active_fans_rate', 'percent'],
    ['thumbnailClickPct', 'tm_rate', 'percent'],
    ['threeSecondExitPct', 'crash_rate', 'percent'],
    ['interactionPct', 'interact_rate', 'percent'],
    ['playToFollowerPct', 'play_trans_fan_rate', 'percent'],
  ]
  const d = await getJson('https://member.bilibili.com/x/web/data/archive_diagnose/compare?size=100')
  if (isAuth(d)) return { error: 'not_logged_in', message: String(d.message || d.msg || ''), hint: loginHint }
  if (!d || d.code !== 0) return { error: 'Creator comparison API failed: ' + ((d && (d.message || d.msg)) || 'unknown') + ' (' + (d && d.code) + ')', hint: 'Check that member.bilibili.com/platform/home loads in this browser' }
  const list = d.data && Array.isArray(d.data.list) ? d.data.list : null
  if (!list) return { error: 'Creator comparison API returned no list', hint: 'Bilibili may have changed the response; nothing was read' }
  const target = list.find((row) => row && typeof row === 'object' && row.bvid === bvid)

  if (target) {
    const stat = target.stat && typeof target.stat === 'object' ? target.stat : {}
    const values = {}
    const metrics = []
    const missing = []
    for (const [metric, key, unit, where] of METRICS) {
      const src = where === 'target' ? target : stat
      const v = src[key]
      let value = null
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && !(unit === 'percent' && v > 10000)) {
        value = unit === 'percent' ? v / 100 : v
      } else if (v !== null) {
        missing.push(metric)
      }
      values[metric] = value
      metrics.push({ metric, value, unit })
    }
    if (metrics.every((m) => m.value === null)) {
      return { error: 'no_stats_yet', bvid, hint: 'Bilibili has not produced creator analytics for this video yet; try again later' }
    }
    return { ok: true, bvid, title: target.title || null, source: 'creator_center', values, metrics, missing }
  }

  // ---- not among the latest 100: the public counts ------------------------
  const v = await getJson('https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(bvid))
  if (!v || v.code !== 0 || !v.data) {
    return {
      error: 'not_found',
      bvid,
      hint: 'The video is not among this account\'s latest 100 in the creator center, and its public page did not answer (' + ((v && v.message) || 'unknown') + '). Check the BV id',
    }
  }
  const s = v.data.stat || {}
  const n = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
  const pub = {
    playCount: n(s.view), likeCount: n(s.like), commentCount: n(s.reply), danmakuCount: n(s.danmaku),
    favoriteCount: n(s.favorite), coinCount: n(s.coin), shareCount: n(s.share), durationSeconds: n(v.data.duration),
  }
  const values = {}
  const metrics = []
  for (const [metric, , unit] of METRICS) {
    const value = Object.prototype.hasOwnProperty.call(pub, metric) ? pub[metric] : null
    values[metric] = value
    metrics.push({ metric, value, unit })
  }
  return {
    ok: true,
    bvid,
    title: v.data.title || null,
    source: 'public',
    owner: v.data.owner ? { mid: String(v.data.owner.mid), name: v.data.owner.name || null } : null,
    note: 'Not among this account\'s latest 100 videos in the creator center, so only the public counts are filled; follower and rate metrics are null',
    values,
    metrics,
    missing: [],
  }
}
