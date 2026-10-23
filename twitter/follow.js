// Ported from jackwener/OpenCLI v1.8.8, clis/twitter/follow.js
// (https://github.com/jackwener/opencli), Copyright 2025 jackwener, licensed
// under the Apache License 2.0 (http://www.apache.org/licenses/LICENSE-2.0);
// full text in twitter/LICENSE-OpenCLI.
// Modified by chrome-use: rewritten as a chrome-use site adapter that runs in
// the logged-in x.com tab (the first run opens the profile, --until-done
// reruns it there); the handle is validated before use (OpenCLI spliced it
// into page script); the Follow button is the one for this handle in the
// profile header, not the first "-follow" button on the page, which could be
// a "Who to follow" suggestion; a protected account's pending request,
// a blocked account and your own profile are told apart; after the click it
// waits up to 6 s for the change; results are
// {ok, status: "followed" | "requested" | "already_following" |
// "already_requested"} and failures {error, hint}.
/* @meta
{
  "name": "twitter/follow",
  "description": "Follow one X account as the signed-in account, the way a person does: open the profile, click Follow. An account already followed (or with a pending request) is left as is (never unfollowed). Run with --until-done: the first run opens the profile and the rerun follows",
  "domain": "x.com",
  "timeout": 60,
  "retryStatuses": ["navigating"],
  "args": {
    "username": {"required": true, "description": "The handle, with or without @, or the profile URL (https://x.com/<handle>)"}
  },
  "capabilities": ["dom"],
  "world": "isolated",
  "readOnly": false,
  "example": "chrome-use site twitter/follow leeguooooo --until-done"
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
  const RESERVED = ['home', 'i', 'explore', 'search', 'notifications', 'messages', 'settings', 'compose', 'login', 'logout', 'signup', 'tos', 'privacy', 'jobs']

  // ---- the handle -------------------------------------------------------
  let raw = String(args.username == null ? '' : args.username).trim()
  if (!raw) return { error: 'Missing argument: username', hint: 'Pass a handle, e.g. chrome-use site twitter/follow leeguooooo --until-done' }
  if (/^https?:\/\//i.test(raw)) {
    let u = null
    try { u = new URL(raw) } catch (e) { u = null }
    const m = u && u.protocol === 'https:' && isTwitterHost(u.hostname.toLowerCase()) && u.pathname.match(/^\/([^/]+)\/?$/)
    if (!m) return { error: 'Not an x.com profile URL: ' + raw, hint: 'Use https://x.com/<handle> or the handle' }
    raw = m[1]
  }
  const handle = raw.replace(/^@/, '')
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle) || RESERVED.includes(handle.toLowerCase())) {
    return { error: 'Not an X handle: ' + raw, hint: 'A handle is 1 to 15 letters, digits or _' }
  }
  const lower = handle.toLowerCase()

  // ---- open the profile first -------------------------------------------
  const path = String(W.location.pathname || '').replace(/\/+$/, '').toLowerCase()
  if (path !== '/' + lower) {
    const url = 'https://x.com/' + handle
    setTimeout(() => W.location.assign(url), 800)
    return { status: 'navigating', url, retryAfterMs: 4000, hint: 'Opening the profile; run the same command again there, or pass --until-done' }
  }

  const visible = (el) => !!el && (el.offsetParent !== null || (el.getClientRects && el.getClientRects().length > 0))
  // X gives the button data-testid "<user id>-follow" (or -unfollow, -cancel
  // for a pending request, -unblock). Suggestions ("Who to follow", "You might
  // like") have the same kind of button, so only the profile's own counts:
  // the one whose label names this handle, outside any user cell or tweet.
  const STATE = /^(\d+)-(follow|unfollow|cancel|unblock)$/
  const profileButton = () => {
    const column = D.querySelector('[data-testid="primaryColumn"]') || D
    const buttons = Array.from(column.querySelectorAll('[data-testid$="-follow"],[data-testid$="-unfollow"],[data-testid$="-cancel"],[data-testid$="-unblock"]'))
      .filter((el) => STATE.test(String(el.getAttribute('data-testid') || '')) && visible(el)
        && !el.closest('[data-testid="UserCell"]') && !el.closest('article'))
    const named = buttons.filter((el) => String(el.getAttribute('aria-label') || '').toLowerCase().includes('@' + lower))
    if (named.length) return named[0]
    // No label (or a label without the handle): only an unambiguous header button.
    return buttons.length === 1 ? buttons[0] : null
  }
  const stateOf = (el) => {
    const m = String(el.getAttribute('data-testid') || '').match(STATE)
    return m ? { userId: m[1], state: m[2] } : null
  }

  let btn = null
  for (let i = 0; i < 40 && !btn; i += 1) {
    btn = profileButton()
    if (!btn) await sleep(250)
  }
  if (!btn) {
    if (D.querySelector('[data-testid="editProfileButton"]')) return { error: 'own_account', username: handle, hint: 'This is the signed-in account\'s own profile. Nothing changed' }
    if (D.querySelector('[data-testid="emptyState"]')) return { error: 'user_not_found', username: handle, hint: 'The profile does not exist or is suspended. Nothing changed' }
    return { error: 'follow_button_not_found', username: handle, hint: 'No Follow button for @' + handle + ' on the profile; check that x.com is signed in. Nothing changed' }
  }

  const { userId, state } = stateOf(btn)
  if (state === 'unfollow') return { ok: true, status: 'already_following', username: handle, user_id: userId }
  if (state === 'cancel') return { ok: true, status: 'already_requested', username: handle, user_id: userId, hint: 'The account is protected and a follow request is already pending' }
  if (state === 'unblock') return { error: 'blocked', username: handle, user_id: userId, hint: 'The signed-in account blocks @' + handle + '; unblock first. Nothing changed' }

  await press(btn)
  // Confirm on the same user's button: it turns into -unfollow, or -cancel
  // when the account is protected and the follow is a request.
  for (let i = 0; i < 24; i += 1) {
    await sleep(250)
    if (D.querySelector('[data-testid="' + userId + '-unfollow"]')) return withUi({ ok: true, status: 'followed', username: handle, user_id: userId })
    if (D.querySelector('[data-testid="' + userId + '-cancel"]')) return withUi({ ok: true, status: 'requested', username: handle, user_id: userId, hint: 'The account is protected: a follow request was sent' })
  }
  return {
    error: 'unconfirmed',
    username: handle,
    user_id: userId,
    hint: 'Follow was clicked but the button did not change within 6 s. Open the profile to check; running the command again is safe, it never unfollows',
  }
}
