/* @meta
{
  "name": "xiaohongshu-creator/me",
  "description": "Signed-in Xiaohongshu creator account: profile counts plus the data center's 7/30-day summary",
  "domain": "creator.xiaohongshu.com",
  "args": {
    "summary": {"required": false, "description": "Include the 7/30-day data-center summary (default true; false saves one request)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "chrome-use site xiaohongshu-creator/me"
}
*/

async function(args) {
  args = args || {}
  const budget = xhscBudget()
  const ready = await xhscReady(budget)
  if (ready.error) return ready
  const { client, user } = ready
  const wantSummary = String(args.summary).toLowerCase() !== 'false'

  // personal_info is what the creator home page header renders. The user id is
  // not in it; the page's own Vuex store already holds it, so no extra call.
  // Both requests go out together, as they do when the home page loads.
  const [info, acct] = await Promise.all([
    xhscGet(client, '/api/galaxy/creator/home/personal_info', { transform: true }, budget),
    wantSummary
      ? xhscGet(client, '/api/galaxy/v2/creator/datacenter/account/base', { transform: true }, budget)
      : null,
  ])
  if (!info.ok) return { error: info.error, hint: info.hint, status: info.status }
  const p = info.data || {}

  const out = {
    user_id: user.userId,
    nickname: p.name || user.userName || null,
    red_id: p.redNum || user.redId || null,
    avatar: p.avatar || user.userAvatar || null,
    desc: p.personalDesc || null,
    fans: xhscNum(p.fansCount),
    follows: xhscNum(p.followCount),
    // 获赞与收藏: XHS only publishes the combined figure.
    likes_and_collects: xhscNum(p.favedCount),
    level: xhscNum(p.growInfo && p.growInfo.level),
    profile_url: 'https://www.xiaohongshu.com/user/profile/' + user.userId,
    data_center: null,
  }

  if (!acct) return out
  if (!acct.ok) {
    // The profile half is still good; say why the summary is missing.
    out.data_center = { error: acct.error, hint: acct.hint || null }
    return out
  }
  const period = (d) => {
    if (!d || typeof d !== 'object') return null
    return {
      start: xhscDateFromMs(d.beginTime),
      end: xhscDateFromMs(d.endTime),
      impressions: xhscNum(d.implCount),
      views: xhscNum(d.viewCount),
      cover_click_rate_pct: xhscNum(d.coverClickRate),
      avg_view_time_sec: xhscNum(d.avgViewTime != null ? d.avgViewTime : d.viewTimeAvg),
      home_views: xhscNum(d.homeViewCount),
      likes: xhscNum(d.likeCount),
      collects: xhscNum(d.collectCount),
      comments: xhscNum(d.commentCount),
      shares: xhscNum(d.shareCount),
      new_fans: xhscNum(d.riseFansCount),
      lost_fans: xhscNum(d.lossFansCount),
      net_new_fans: xhscNum(d.netRiseFansCount),
      notes_published: xhscNum(d.publishNoteNum),
    }
  }
  out.data_center = {
    last_7_days: period(acct.data && acct.data.seven),
    last_30_days: period(acct.data && acct.data.thirty),
  }
  return out
}
