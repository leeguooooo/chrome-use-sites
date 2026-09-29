/* @meta
{
  "name": "xiaohongshu-creator/notes",
  "description": "Your published notes from the creator center note manager (笔记管理), with status and metrics",
  "domain": "creator.xiaohongshu.com",
  "args": {
    "limit": {"required": false, "description": "How many notes to return (default 20, max 50; the server pages by 10)"},
    "page": {"required": false, "description": "Cursor: the next_page from a previous call (default 0, the first page)"},
    "tab": {"required": false, "description": "all (default) | published | reviewing | rejected | scheduled — or 全部/已发布/审核中/未通过/定时发布"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "chrome-use site xiaohongshu-creator/notes --limit 10 --tab published"
}
*/

async function(args) {
  args = args || {}
  // The note manager's tab ids. `tab_status` on a note uses a DIFFERENT
  // numbering (1 published, 2 reviewing, 3 rejected, 4 scheduled).
  const TABS = {
    all: 0, '全部': 0, '0': 0,
    published: 1, '已发布': 1, '1': 1,
    reviewing: 2, review: 2, '审核中': 2, '2': 2,
    rejected: 3, deny: 3, '未通过': 3, '3': 3,
    scheduled: 4, '定时发布': 4, '4': 4,
  }
  const STATUS = {
    1: ['published', '已发布'],
    2: ['reviewing', '审核中'],
    3: ['rejected', '未通过'],
    4: ['scheduled', '定时发布'],
  }
  const VISIBILITY = {
    0: ['public', '公开可见'],
    1: ['private', '仅自己可见'],
    2: ['partially_hidden', '部分人不可见'],
    3: ['partially_visible', '部分人可见'],
    4: ['friends_only', '仅互关好友可见'],
  }

  const tabKey = args.tab == null || args.tab === '' ? 'all' : String(args.tab).trim().toLowerCase()
  if (!(tabKey in TABS)) {
    return { error: 'Unknown tab: ' + args.tab, hint: 'Use all, published, reviewing, rejected or scheduled.' }
  }
  const tab = TABS[tabKey]
  const limit = xhscCount(args.limit, 20, 50)
  const startRaw = Number(args.page)
  let page = Number.isInteger(startRaw) && startRaw > 0 ? startRaw : 0

  const budget = xhscBudget()
  const ready = await xhscReady(budget)
  if (ready.error) return ready
  const { client } = ready

  // One request per server page of 10, capped by `limit`. This is the same
  // call the note manager makes as you scroll, and it stops at the first
  // short/last page instead of probing further.
  const raw = []
  let total = null
  let next = page
  let lastFetched = page
  let partial = null
  const maxPages = Math.ceil(limit / 10)
  for (let i = 0; i < maxPages && next !== -1 && raw.length < limit; i++) {
    lastFetched = next
    const res = await xhscGet(client, '/api/galaxy/v2/creator/note/user/posted', {
      params: { tab, page: next },
      withCredentials: true,
    }, budget)
    if (!res.ok) {
      if (!raw.length) return { error: res.error, hint: res.hint, status: res.status }
      // Out of time or failed on a later page: return what we have, with the
      // cursor pointing at the page that did not arrive.
      partial = res.error
      next = lastFetched
      break
    }
    const d = res.data || {}
    if (total === null && Array.isArray(d.tags) && d.tags[0]) total = xhscNum(d.tags[0].notes_count)
    const notes = Array.isArray(d.notes) ? d.notes : []
    raw.push(...notes)
    // The server returns the NEXT page number, or -1 once it has none left.
    next = typeof d.page === 'number' ? d.page : -1
    if (!notes.length) next = -1
  }

  // The cursor has page granularity. If `limit` cut the last page short, point
  // next_page back at that page: resuming repeats a few notes (dedupe by id)
  // rather than silently skipping the ones that were cut.
  if (raw.length > limit && !partial) next = lastFetched

  const notes = raw.slice(0, limit).map((n) => {
    const status = STATUS[n.tab_status] || [null, null]
    const vis = VISIBILITY[n.permission_code] || [null, null]
    const duration = n.video_info && xhscNum(n.video_info.duration)
    const isVideo = n.type === 'video' || !!duration
    // `time` is China-local "YYYY-MM-DD HH:mm"; give it an explicit offset.
    const tm = typeof n.time === 'string' && n.time.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?::(\d{2}))?$/)
    const images = Array.isArray(n.images_list) ? n.images_list : []
    return {
      id: n.id,
      title: n.display_title || null,
      type: isVideo ? 'video' : 'normal',
      published_at: tm ? tm[1] + 'T' + tm[2] + ':' + (tm[3] || '00') + '+08:00' : null,
      status: status[0],
      status_text: status[1],
      status_code: n.tab_status == null ? null : n.tab_status,
      visibility: vis[0],
      visibility_text: n.permission_msg || vis[1],
      visibility_code: n.permission_code == null ? null : n.permission_code,
      pinned: n.sticky === true,
      scheduled_at: n.schedule_post_time
        ? xhscIsoFromMs(n.schedule_post_time > 1e12 ? n.schedule_post_time : n.schedule_post_time * 1000)
        : null,
      video_duration: isVideo ? duration || null : null,
      cover: (images[0] && images[0].url) || null,
      url: xhscNoteUrl(n.id, n.xsec_token, n.xsec_source),
      xsec_token: n.xsec_token || null,
      views: xhscNum(n.view_count),
      likes: xhscNum(n.likes),
      collects: xhscNum(n.collected_count),
      comments: xhscNum(n.comments_count),
      shares: xhscNum(n.shared_count),
    }
  })

  return {
    tab: ['all', 'published', 'reviewing', 'rejected', 'scheduled'][tab],
    count: notes.length,
    // tags[0].notes_count: the figure the note manager shows next to the tab.
    total,
    page,
    // Pass back as --page to continue; null means there is nothing more.
    next_page: next === -1 ? null : next,
    // Set when a later page failed or ran out of time; `notes` is still valid.
    partial,
    notes,
  }
}
