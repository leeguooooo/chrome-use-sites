/* @meta
{
  "name": "douyin-creator/works",
  "description": "The signed-in account's own Douyin works, newest first, with plays/likes/comments/shares/collects and whether each is public or private. Private works report 0 plays.",
  "domain": "creator.douyin.com",
  "args": {
    "limit": {"required": false, "description": "How many works to return (default 50, max 500)"},
    "visibility": {"required": false, "description": "all (default) | public | private — filters after fetching"},
    "cursor": {"required": false, "description": "Resume from a next_cursor a previous call returned (default: newest)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "chrome-use site douyin-creator/works --limit 20 --visibility public"
}
*/

async function(args) {
  args = args || {}
  const limit = Math.min(Math.max(parseInt(args.limit, 10) || 50, 1), 500)
  const visibility = String(args.visibility || 'all').toLowerCase()
  if (!['all', 'public', 'private'].includes(visibility)) {
    return { error: 'Bad visibility: ' + args.visibility, hint: 'Use all, public or private' }
  }
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  // The server returns about six works per page whatever page_size says, so a
  // full account is dozens of requests. A dropped request ("Failed to fetch")
  // is retried once; if it fails again, the works so far come back with the
  // cursor to resume from instead of losing the whole call.
  async function page(cursor) {
    const url = '/janus/douyin/creator/pc/work_list?page_size=20&status=0&max_cursor=' + encodeURIComponent(cursor)
    let lastErr = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await fetch(url, { credentials: 'include' })
        if (!resp.ok) { lastErr = 'HTTP ' + resp.status; break }
        const d = await resp.json()
        if (d.status_code !== 0) { lastErr = 'status_code ' + d.status_code + (d.status_msg ? ' ' + d.status_msg : ''); break }
        return { ok: true, d }
      } catch (e) {
        lastErr = 'Network error: ' + (e && e.message || e)
        await sleep(800)
      }
    }
    return { ok: false, error: lastErr }
  }

  const shape = (a) => {
    const s = a.statistics || {}
    const st = a.status || {}
    const priv = Boolean(st.is_private || st.self_see || (st.private_status && st.private_status !== 0))
    return {
      aweme_id: String(a.aweme_id),
      title: a.item_title || (a.desc || '').split('\n')[0].slice(0, 80),
      desc: a.desc || '',
      created_at: a.create_time ? new Date(Number(a.create_time) * 1000).toISOString() : null,
      duration_sec: a.duration ? Math.round(Number(a.duration) / 1000) : null,
      visibility: priv ? 'private' : 'public',
      in_review: Boolean(st.in_reviewing),
      plays: num(s.play_count),
      likes: num(s.digg_count),
      comments: num(s.comment_count),
      shares: num(s.share_count),
      collects: num(s.collect_count),
      url: 'https://www.douyin.com/video/' + a.aweme_id,
    }
  }

  const works = []
  let cursor = args.cursor != null && args.cursor !== '' ? String(args.cursor) : '0'
  let total = null
  let hasMore = true
  let error = null
  for (let i = 0; i < 120 && hasMore && works.length < limit; i++) {
    const r = await page(cursor)
    if (!r.ok) { error = r.error; break }
    const d = r.d
    if (total == null) total = num(d.total)
    for (const a of d.aweme_list || []) {
      const w = shape(a)
      if (visibility === 'all' || w.visibility === visibility) works.push(w)
      if (works.length >= limit) break
    }
    hasMore = Boolean(d.has_more) && d.max_cursor != null && String(d.max_cursor) !== cursor
    cursor = String(d.max_cursor)
  }

  if (error && works.length === 0) {
    return { error, hint: error.startsWith('HTTP 4') || error.startsWith('status_code') ? 'Open https://creator.douyin.com and sign in, then retry' : 'Retry; pass --cursor to resume' }
  }
  return {
    count: works.length,
    total,
    has_more: hasMore,
    next_cursor: hasMore ? cursor : null,
    error: error || undefined,
    works,
  }
}
