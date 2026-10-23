// Ported from jackwener/OpenCLI v1.8.8, clis/twitter/like.js and the
// parseTweetUrl / buildTwitterArticleScopeSource helpers in
// clis/twitter/shared.js (https://github.com/jackwener/opencli), Copyright 2025
// jackwener, licensed under the Apache License 2.0
// (http://www.apache.org/licenses/LICENSE-2.0); full text in
// twitter/LICENSE-OpenCLI.
// Modified by chrome-use: rewritten as a chrome-use site adapter that runs in
// the logged-in x.com tab (the first run opens the tweet, --until-done reruns
// it there); it also takes a bare numeric id; the buttons are looked up only
// inside the tweet's own <article>; after the click it waits up to 6 s for
// Unlike instead of checking once after 1 s; results are
// {ok, status: "liked" | "already_liked"} and failures {error, hint}.
/* @meta
{
  "name": "twitter/like",
  "description": "Like one tweet as the signed-in account, the way a person does: open the tweet, click its heart. A tweet already liked is left as is (never unliked). Run with --until-done: the first run opens the tweet and the rerun likes it",
  "domain": "x.com",
  "timeout": 60,
  "retryStatuses": ["navigating"],
  "args": {
    "tweet": {"required": true, "description": "The tweet's status URL (https://x.com/name/status/123…) or its numeric id"}
  },
  "capabilities": ["dom"],
  "world": "isolated",
  "readOnly": false,
  "example": "chrome-use site twitter/like https://x.com/someone/status/1890000000000000000 --until-done"
}
*/

async function(args) {
  args = args || {}
  const W = window
  const D = document
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  // chrome-use 1.5.253+ clicks through args.ui: real pointer events
  // (isTrusted) at a human pace. Older versions, or a ui call that fails, get
  // el.click(); ui_fallbacks in the result says when that happened.
  const UI = args.ui || null
  const uiFallbacks = []
  const press = async (el) => {
    if (UI) {
      try { await UI.click(el); return } catch (e) { uiFallbacks.push(String(e && e.message || e)) }
    }
    el.click()
  }
  const withUi = (r) => (uiFallbacks.length ? Object.assign(r, { ui_fallbacks: uiFallbacks }) : r)
  const isTwitterHost = (h) => h === 'x.com' || h === 'twitter.com' || h.endsWith('.x.com') || h.endsWith('.twitter.com')
  const statusPath = /^\/(?:[^/]+|i)\/status\/(\d+)\/?$/

  // The tweet id: a bare id, or the id in an https x.com/twitter.com status URL.
  const raw = String(args.tweet == null ? '' : args.tweet).trim()
  if (!raw) return { error: 'Missing argument: tweet', hint: 'Pass the tweet URL or id, e.g. chrome-use site twitter/like https://x.com/someone/status/123 --until-done' }
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
  // The <article> whose own status link is this tweet: on a conversation page
  // the replies and the parent tweet are articles too, each with a heart.
  const findTargetArticle = () => Array.from(D.querySelectorAll('article'))
    .find((a) => Array.from(a.querySelectorAll('a[href*="/status/"]')).some((link) => statusIdOf(link.href || link.getAttribute('href')) === tweetId))
  const button = (article, testid) => article && Array.from(article.querySelectorAll('[data-testid="' + testid + '"]'))
    .find((el) => el.closest('article') === article && visible(el))

  // The article and its buttons can hydrate late on a slow network.
  let article = null
  let like = null
  let unlike = null
  for (let i = 0; i < 40; i += 1) {
    article = findTargetArticle()
    unlike = button(article, 'unlike')
    like = button(article, 'like')
    if (unlike || like) break
    await sleep(250)
  }
  if (!article) return { error: 'tweet_not_found', id: tweetId, hint: 'The tweet did not show on its page (deleted, or not visible to this account). Nothing changed' }
  if (unlike) return { ok: true, status: 'already_liked', id: tweetId }
  if (!like) return { error: 'like_button_not_found', id: tweetId, hint: 'The tweet has no Like button here; check that x.com is signed in. Nothing changed' }

  await press(like)
  // Confirm on the same tweet: its heart turns into Unlike.
  for (let i = 0; i < 24; i += 1) {
    await sleep(250)
    if (button(findTargetArticle() || article, 'unlike')) return withUi({ ok: true, status: 'liked', id: tweetId })
  }
  return {
    error: 'unconfirmed',
    id: tweetId,
    hint: 'Like was clicked but the heart did not turn into Unlike within 6 s. Open the tweet to check; running the command again is safe, it never unlikes',
  }
}
