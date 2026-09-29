/* @meta
{
  "name": "xiaohongshu-creator/note-stats",
  "description": "Data-center analytics (笔记数据) for one of your own notes: views, watch time, rates, engagement, traffic sources, audience",
  "domain": "creator.xiaohongshu.com",
  "args": {
    "note_id": {"required": true, "description": "Note id, or a www.xiaohongshu.com/explore/<id> URL"},
    "audience": {"required": false, "description": "Include traffic sources and audience portrait (default true; false saves two requests)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "chrome-use site xiaohongshu-creator/note-stats 6abbe0ef000000001203e9c7"
}
*/

async function(args) {
  args = args || {}
  const noteId = xhscParseNoteId(args.note_id)
  if (!noteId) {
    return {
      error: 'Missing or invalid note_id: ' + (args.note_id == null ? '' : args.note_id),
      hint: 'Pass a 24-hex note id or a https://www.xiaohongshu.com/explore/<id> URL.',
    }
  }

  const budget = xhscBudget()
  const ready = await xhscReady(budget)
  if (ready.error) return ready
  const { client } = ready
  const opts = { params: { note_id: noteId }, transform: true }
  const wantAudience = String(args.audience).toLowerCase() !== 'false'

  // The same calls the 笔记数据 detail page makes on open, sent together as it
  // sends them.
  const [base, src, det] = await Promise.all([
    xhscGet(client, '/api/galaxy/creator/datacenter/note/base', opts, budget),
    wantAudience ? xhscGet(client, '/api/galaxy/creator/datacenter/note/audience/source', opts, budget) : null,
    wantAudience ? xhscGet(client, '/api/galaxy/creator/datacenter/note/audience/source/detail', opts, budget) : null,
  ])
  if (!base.ok) return { error: base.error, hint: base.hint, status: base.status, note_id: noteId }
  const b = base.data || {}
  const info = b.noteInfo || {}
  if (!info.id) {
    return {
      error: 'No data-center record for note ' + noteId,
      hint: 'note-stats only covers notes published by the signed-in account.',
      note_id: noteId,
    }
  }
  const isVideo = String(info.type || '').toUpperCase() === 'VIDEO'

  const out = {
    note_id: info.id,
    type: isVideo ? 'video' : 'normal',
    desc: info.desc || null,
    published_at: xhscIsoFromMs(info.postTime),
    days_since_post: xhscNum(b.notePostDays),
    // When the data center last rolled up this note's numbers. Absent for
    // notes still inside the first day, when most rates read -1 (→ null).
    data_updated_at: xhscIsoFromMs(b.basicDataLastUpdateTime),
    cover: info.coverUrl || null,
    url: 'https://www.xiaohongshu.com/explore/' + info.id,
    topics: Array.isArray(info.tags) ? info.tags.map((t) => t && t.name).filter(Boolean) : [],
    metrics: {
      impressions: xhscNum(b.implCount),
      views: xhscNum(b.viewCount),
      cover_click_rate_pct: xhscNum(b.coverClickRate),
      avg_view_time_sec: xhscNum(b.viewTimeAvg),
      likes: xhscNum(b.likeCount),
      collects: xhscNum(b.collectCount),
      comments: xhscNum(b.commentCount),
      shares: xhscNum(b.shareCount),
      follows_gained: xhscNum(b.riseFansCount),
      danmaku: xhscNum(b.danmakuCount),
      interaction_rate_pct: xhscNum(b.interactionRate),
      // 图文 only: how many images a viewer swipes through on average.
      avg_images_viewed: isVideo ? null : xhscNum(b.avgViewImage),
      // Video only. Image notes report 0 for these, which means "n/a", not 0%.
      full_view_rate_pct: isVideo ? xhscNum(b.fullViewRate) : null,
      finish_5s_rate_pct: isVideo ? xhscNum(b.finish5sRate) : null,
      exit_2s_rate_pct: isVideo ? xhscNum(b.exitView2sRate) : null,
      play_60s_count: isVideo ? xhscNum(b.play60sCount) : null,
    },
    traffic_sources: null,
    audience: null,
  }

  if (!wantAudience) return out

  // Each item is {title, value, valueWithDouble}; valueWithDouble is the
  // percentage the page draws (value is sometimes a rounded copy).
  const shares = (list) =>
    Array.isArray(list)
      ? list.map((x) => ({
          name: (x && (x.title || x.name)) || null,
          pct: xhscNum(x && (x.valueWithDouble != null ? x.valueWithDouble : x.value)),
        }))
      : []

  if (src.ok) {
    const s = src.data || {}
    out.traffic_sources = s.noData
      ? { available: false, reason: s.noDataTipMsg || null, sources: [] }
      : { available: true, reason: null, sources: shares(s.source) }
  } else {
    out.traffic_sources = { available: false, reason: src.error, sources: [] }
  }

  if (det.ok) {
    const d = det.data || {}
    out.audience = {
      available: !d.noData,
      reason: d.noData ? d.noDataTipMsg || null : null,
      gender: shares(d.gender),
      age: shares(d.age),
      city: shares(d.city),
      interest: shares(d.interest),
    }
  } else {
    out.audience = { available: false, reason: det.error, gender: [], age: [], city: [], interest: [] }
  }
  return out
}
