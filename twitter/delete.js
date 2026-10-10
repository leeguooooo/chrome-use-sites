// Ported from jackwener/OpenCLI v1.8.8, clis/twitter/delete.js and the
// parseTweetUrl / buildTwitterArticleScopeSource helpers in
// clis/twitter/shared.js (https://github.com/jackwener/opencli), Copyright 2025
// jackwener, licensed under the Apache License 2.0
// (http://www.apache.org/licenses/LICENSE-2.0); full text in
// twitter/LICENSE-OpenCLI.
// Modified by chrome-use: rewritten as a chrome-use site adapter that runs in
// the logged-in x.com tab (the first run opens the tweet, --until-done reruns
// it there); it also takes a bare numeric id; failures come back as
// {error, hint}.
/* @meta
{
  "name": "twitter/delete",
  "description": "Delete one of the signed-in account's own tweets the way a person does: open the tweet, its ⋯ menu, Delete, confirm. Run with --until-done: the first run opens the tweet and the rerun deletes it",
  "domain": "x.com",
  "timeout": 90,
  "retryStatuses": ["navigating"],
  "args": {
    "tweet": {"required": true, "description": "The tweet's status URL (https://x.com/name/status/123…) or its numeric id"}
  },
  "capabilities": ["dom"],
  "readOnly": false,
  "example": "chrome-use site twitter/delete https://x.com/you/status/1890000000000000000 --until-done"
}
*/

async function(args) {
  args = args || {}
  const W = window
  const D = document
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const isTwitterHost = (h) => h === 'x.com' || h === 'twitter.com' || h.endsWith('.x.com') || h.endsWith('.twitter.com')
  const statusPath = /^\/(?:[^/]+|i)\/status\/(\d+)\/?$/

  // The tweet id: a bare id, or the id in an https x.com/twitter.com status URL.
  const raw = String(args.tweet == null ? '' : args.tweet).trim()
  if (!raw) return { error: 'Missing argument: tweet', hint: 'Pass the tweet URL or id, e.g. chrome-use site twitter/delete https://x.com/you/status/123 --until-done' }
  let tweetId = null
  if (/^\d+$/.test(raw)) {
    tweetId = raw
  } else {
    let u = null
    try { u = new URL(raw) } catch (e) { u = null }
    if (!u || u.protocol !== 'https:' || !isTwitterHost(u.hostname.toLowerCase())) {
      return { error: 'Not an x.com tweet URL: ' + raw, hint: 'Use https://x.com/<user>/status/<id> or the numeric id' }
    }
    const m = u.pathname.match(statusPath)
    if (!m) return { error: 'No tweet id in ' + raw, hint: 'Use https://x.com/<user>/status/<id> or the numeric id' }
    tweetId = m[1]
  }

  // Open the tweet's own page first: the navigation ends this run, and
  // --until-done reruns the command there.
  const here = String(W.location.pathname || '').match(statusPath)
  if (!here || here[1] !== tweetId) {
    const url = 'https://x.com/i/status/' + tweetId
    setTimeout(() => W.location.assign(url), 800)
    return { status: 'navigating', url, retryAfterMs: 4000, hint: 'Opening the tweet; run the same command again there, or pass --until-done' }
  }

  const visible = (el) => !!el && (el.offsetParent !== null || (el.getClientRects && el.getClientRects().length > 0))
  const statusIdOf = (href) => {
    try {
      const u = new URL(href, W.location.origin)
      if (u.protocol !== 'https:' || !isTwitterHost(u.hostname.toLowerCase())) return null
      const m = u.pathname.match(statusPath)
      return m ? m[1] : null
    } catch (e) {
      return null
    }
  }
  // The <article> whose own status link is this tweet (a quoted or replied-to
  // tweet on the page has a different id).
  const findTargetArticle = () => Array.from(D.querySelectorAll('article'))
    .find((a) => Array.from(a.querySelectorAll('a[href*="/status/"]')).some((link) => statusIdOf(link.href || link.getAttribute('href')) === tweetId))

  // The article's self-link can hydrate late on a slow network.
  let article = findTargetArticle()
  for (let i = 0; i < 40 && !article; i += 1) {
    await sleep(250)
    article = findTargetArticle()
  }
  if (!article) return { error: 'tweet_not_found', id: tweetId, hint: 'The tweet did not show on its page (deleted already, or not visible to this account). Nothing changed' }

  const own = (el) => el.closest('article') === article
  // X localizes the ⋯ label (zh-Hans: 更多); prefer the data-testid.
  const moreMenu = Array.from(article.querySelectorAll('[data-testid="caret"]')).filter(own).find(visible)
    || Array.from(article.querySelectorAll('button,[role="button"]')).filter(own)
      .find((el) => visible(el) && /^(More|更多)/.test(String(el.getAttribute('aria-label') || '').trim()))
  if (!moreMenu) return { error: 'menu_not_found', id: tweetId, hint: 'The tweet has no ⋯ menu here; check that x.com is signed in. Nothing changed' }

  const before = new Set(Array.from(D.querySelectorAll('[role="menuitem"]')))
  moreMenu.click()
  await sleep(1000)
  const items = Array.from(D.querySelectorAll('[role="menuitem"]')).filter((item) => visible(item) && !before.has(item))
  // Delete / 删除, but never the "Add/remove from Lists" row.
  const deleteItem = items.find((item) => {
    const text = String(item.textContent || '').trim()
    return (text.includes('Delete') || text.includes('删除')) && !text.includes('List') && !text.includes('列表')
  })
  if (!deleteItem) return { error: 'not_own_tweet', id: tweetId, hint: 'The tweet menu has no Delete, so it is not this account\'s tweet. Nothing changed' }
  deleteItem.click()
  await sleep(1000)

  const confirm = D.querySelector('[data-testid="confirmationSheetConfirm"]')
  if (!confirm) return { error: 'confirm_not_shown', id: tweetId, hint: 'The delete confirmation did not appear; nothing was confirmed' }
  // Report at once: X may leave the tweet's page after a delete, which would
  // end this run before it could answer.
  confirm.click()
  return { ok: true, status: 'deleted', id: tweetId }
}
