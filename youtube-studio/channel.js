/* @meta
{
  "name": "youtube-studio/channel",
  "description": "The signed-in YouTube channel from Studio: subscribers, video count, total views, and its uploads (videos and Shorts, any visibility) with views/likes/comments",
  "domain": "studio.youtube.com",
  "args": {
    "limit": {"required": false, "description": "How many uploads to list, newest first (default 30, max 500; 0 = channel totals only)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "chrome-use site youtube-studio/channel --limit 10"
}
*/

async function(args) {
  args = args || {}
  const parsed = parseInt(args.limit, 10)
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 500) : 30
  const cfg = (k) => (window.ytcfg && typeof window.ytcfg.get === 'function' ? window.ytcfg.get(k) : undefined)
  const channelId = cfg('CHANNEL_ID')
  const apiKey = cfg('INNERTUBE_API_KEY')
  if (!channelId || !apiKey) {
    return { error: 'Not on a signed-in YouTube Studio page', hint: 'Open https://studio.youtube.com and sign in, then retry' }
  }
  const sapisid = (document.cookie.match(/(?:^|;\s*)(?:SAPISID|__Secure-3PAPISID)=([^;]+)/) || [])[1]
  if (!sapisid) return { error: 'No SAPISID cookie', hint: 'Sign in to YouTube in this browser, then retry' }

  // Studio's own calls carry a SAPISIDHASH: sha1("<ts> <SAPISID> <origin>").
  const ts = Math.floor(Date.now() / 1000)
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(ts + ' ' + sapisid + ' ' + location.origin))
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  const context = JSON.parse(JSON.stringify(cfg('INNERTUBE_CONTEXT') || {}))
  context.user = Object.assign({}, context.user, {
    delegationContext: { externalChannelId: channelId, roleType: { channelRoleType: 'CREATOR_CHANNEL_ROLE_TYPE_OWNER' } },
  })
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'SAPISIDHASH ' + ts + '_' + hash,
    'X-Goog-AuthUser': String(cfg('SESSION_INDEX') || 0),
    'X-Origin': location.origin,
    'X-YouTube-Client-Name': String(cfg('INNERTUBE_CONTEXT_CLIENT_NAME') || 62),
    'X-YouTube-Client-Version': String(cfg('INNERTUBE_CONTEXT_CLIENT_VERSION') || ''),
  }
  async function call(path, body) {
    let resp
    try {
      resp = await fetch('/youtubei/v1/' + path + '?alt=json&key=' + encodeURIComponent(apiKey), {
        method: 'POST', credentials: 'include', headers, body: JSON.stringify(Object.assign({ context }, body)),
      })
    } catch (e) {
      return { error: 'Network error: ' + (e && e.message || e) }
    }
    const d = await resp.json().catch(() => null)
    if (!resp.ok || !d || d.error) {
      return { error: 'HTTP ' + resp.status + (d && d.error && d.error.message ? ': ' + d.error.message : ''), status: resp.status }
    }
    return { d }
  }
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

  const ch = await call('creator/get_creator_channels', {
    channelIds: [channelId],
    mask: { channelId: true, title: true, customUrl: true, metric: { all: true } },
  })
  if (ch.error) return { error: ch.error, hint: ch.status === 401 || ch.status === 403 ? 'Sign in to YouTube Studio again' : 'Studio API may have changed' }
  const c = (ch.d.channels || [])[0] || {}
  const m = c.metric || {}
  const out = {
    channel_id: channelId,
    title: c.title || null,
    custom_url: c.customUrl || null,
    url: 'https://www.youtube.com/channel/' + channelId,
    subscribers: num(m.subscriberCount),
    videos: num(m.videoCount),
    total_views: num(m.totalVideoViewCount),
  }
  if (limit === 0) return out

  const PRIVACY = { VIDEO_PRIVACY_PUBLIC: 'public', VIDEO_PRIVACY_UNLISTED: 'unlisted', VIDEO_PRIVACY_PRIVATE: 'private', VIDEO_PRIVACY_DRAFT: 'draft' }
  const uploads = []
  let pageToken = null
  let error = null
  for (let i = 0; i < 20 && uploads.length < limit; i++) {
    const body = {
      filter: { and: { operands: [{ channelIdIs: { value: channelId } }, { videoOriginIs: { value: 'VIDEO_ORIGIN_UPLOAD' } }] } },
      order: 'VIDEO_ORDER_DISPLAY_TIME_DESC',
      pageSize: Math.min(50, limit - uploads.length),
      mask: {
        videoId: true, title: true, privacy: true, contentType: true, lengthSeconds: true,
        timePublishedSeconds: true, timeCreatedSeconds: true, publicMetrics: { all: true }, status: true, draftStatus: true,
      },
    }
    if (pageToken) body.pageToken = pageToken
    const r = await call('creator/list_creator_videos', body)
    if (r.error) { error = r.error; break }
    for (const v of r.d.videos || []) {
      const pm = v.publicMetrics || {}
      const secs = num(v.timePublishedSeconds) || num(v.timeCreatedSeconds)
      uploads.push({
        video_id: v.videoId,
        title: v.title || '',
        type: v.contentType === 'CREATOR_CONTENT_TYPE_SHORTS' ? 'short' : 'video',
        visibility: v.draftStatus && v.draftStatus !== 'DRAFT_STATUS_NONE' ? 'draft' : (PRIVACY[v.privacy] || v.privacy || null),
        published_at: secs ? new Date(secs * 1000).toISOString() : null,
        duration_sec: num(v.lengthSeconds),
        views: num(pm.externalViewCount),
        likes: num(pm.likeCount),
        comments: num(pm.commentCount),
        url: v.contentType === 'CREATOR_CONTENT_TYPE_SHORTS' ? 'https://www.youtube.com/shorts/' + v.videoId : 'https://www.youtube.com/watch?v=' + v.videoId,
      })
    }
    pageToken = r.d.nextPageToken || null
    if (!pageToken) break
  }
  out.uploads = uploads.slice(0, limit)
  if (error) out.uploads_error = error
  return out
}
