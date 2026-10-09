/* @meta
{
  "name": "douyin-creator/me",
  "description": "Signed-in Douyin creator account: nickname, Douyin ID, followers, following, works count and total likes",
  "domain": "creator.douyin.com",
  "args": {},
  "capabilities": ["network"],
  "readOnly": true,
  "example": "chrome-use site douyin-creator/me"
}
*/

async function() {
  let resp
  try {
    resp = await fetch('/web/api/media/user/info/', { credentials: 'include' })
  } catch (e) {
    return { error: 'Network error: ' + (e && e.message || e), hint: 'Retry once; creator.douyin.com dropped the request' }
  }
  if (!resp.ok) return { error: 'HTTP ' + resp.status, hint: 'Open https://creator.douyin.com and sign in, then retry' }
  const d = await resp.json().catch(() => null)
  const u = d && d.user
  if (!d || d.status_code !== 0 || !u || !u.uid) {
    return { error: 'Not signed in to creator.douyin.com', hint: 'Open https://creator.douyin.com in this browser and log in, then retry' }
  }
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
  return {
    uid: String(u.uid),
    nickname: u.nickname || null,
    // 抖音号: the custom one when set, else the numeric short id.
    douyin_id: u.unique_id || u.short_id || null,
    sec_uid: u.sec_uid || null,
    signature: u.signature || '',
    followers: num(u.follower_count),
    following: num(u.following_count),
    // Counts private works too; douyin-creator/works says which are public.
    works: num(u.aweme_count),
    total_likes: num(u.total_favorited),
    avatar: (u.avatar_thumb && u.avatar_thumb.url_list && u.avatar_thumb.url_list[0]) || null,
    profile_url: u.sec_uid ? 'https://www.douyin.com/user/' + u.sec_uid : null,
  }
}
