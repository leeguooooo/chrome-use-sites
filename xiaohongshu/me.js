/* @meta
{
  "name": "xiaohongshu/me",
  "description": "Signed-in Xiaohongshu user on www.xiaohongshu.com with the profile counts (关注 / 粉丝 / 获赞与收藏), IP 属地 and the first page of their notes. No creator-center login needed",
  "domain": "www.xiaohongshu.com",
  "args": {
    "notes": {"required": false, "description": "How many of the newest notes to include (default 0, max 30: the profile page's first load)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "chrome-use site xiaohongshu/me --notes 10"
}
*/

async function(args) {
  args = args || {}
  const wantNotes = Math.min(Math.max(parseInt(args.notes, 10) || 0, 0), 30)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  // Who is signed in: the page's own Pinia user store, as the web app has it.
  let info = null
  for (let i = 0; i < 20 && !info; i++) {
    const app = document.querySelector('#app') && document.querySelector('#app').__vue_app__
    const store = app && app.config && app.config.globalProperties.$pinia && app.config.globalProperties.$pinia._s.get('user')
    const u = store && store.userInfo
    if (u && (u.userId || u.user_id) && !u.guest) info = JSON.parse(JSON.stringify(u))
    else await sleep(250)
  }
  if (!info) return { error: 'Not logged in', hint: 'Open https://www.xiaohongshu.com and log in (QR code), then retry' }
  const userId = info.userId || info.user_id

  // The counts are only in the profile page's server-rendered state. One GET
  // of that page, the same request a visit to the profile makes; Xiaohongshu
  // bans accounts for scripted traffic, so no API calls and no paging.
  let html
  try {
    const resp = await fetch('/user/profile/' + userId, { credentials: 'include' })
    if (!resp.ok) return { error: 'HTTP ' + resp.status, hint: 'Open your profile page once in the browser, then retry' }
    html = await resp.text()
  } catch (e) {
    return { error: 'Network error: ' + (e && e.message || e) }
  }
  const m = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/)
  if (!m) return { error: 'Profile state not found', hint: 'Xiaohongshu may have changed its page; check the profile page source' }
  let state
  try {
    // The state is a JS literal, not JSON: undefined and new Set([...]) appear in it.
    state = JSON.parse(m[1].replace(/\bundefined\b/g, 'null').replace(/new (?:Set|Map)\(\[[^\]]*\]\)/g, '[]'))
  } catch (e) {
    return { error: 'Cannot parse profile state: ' + e.message }
  }
  const page = (state.user && state.user.userPageData) || {}
  const basic = page.basicInfo || {}
  const counts = {}
  for (const it of page.interactions || []) counts[it.type] = it.count
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

  const out = {
    userid: userId,
    nickname: basic.nickname || info.nickname || null,
    red_id: basic.redId || info.redId || info.red_id || null,
    desc: basic.desc != null ? basic.desc : (info.desc || null),
    gender: basic.gender != null ? basic.gender : (info.gender != null ? info.gender : null),
    ip_location: basic.ipLocation || null,
    follows: num(counts.follows),
    fans: num(counts.fans),
    // 获赞与收藏: Xiaohongshu only shows the combined figure.
    likes_and_collects: num(counts.interaction),
    url: 'https://www.xiaohongshu.com/user/profile/' + userId,
  }
  if (wantNotes > 0) {
    const first = (state.user && Array.isArray(state.user.notes) && state.user.notes[0]) || []
    out.notes = first.slice(0, wantNotes).map((n) => {
      const card = n.noteCard || {}
      const id = card.noteId || n.id
      return {
        note_id: id,
        title: card.displayTitle || '',
        type: card.type || null,
        likes: num(card.interactInfo && card.interactInfo.likedCount),
        sticky: Boolean(card.interactInfo && card.interactInfo.sticky),
        url: 'https://www.xiaohongshu.com/explore/' + id + (n.xsecToken ? '?xsec_token=' + encodeURIComponent(n.xsecToken) + '&xsec_source=pc_user' : ''),
      }
    })
  }
  return out
}
