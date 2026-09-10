// Shared auth + fetch plumbing for the `chatgpt/*` adapters.
//
// Every chatgpt.com backend-api call needs a short-lived bearer token that the
// page itself mints at /api/auth/session. Reading it from inside the logged-in
// tab is the whole trick: no API key, no OPENAI_API_KEY, the session cookies
// are already there because it IS the user's browser.
//
// Two failure modes are mapped deliberately, because the caller behaves
// differently for each:
//   * 401/403 → not signed in. Retrying is pointless until the user logs in.
//   * 429 (and the "Too many requests" page dialog) → the ACCOUNT is throttled.
//     Every further call, on any tab, makes it worse. Callers must back off,
//     not poll. This is the failure that running several chatgpt tabs at once
//     produces, so it gets a distinct, loud shape.

/** The page's own bearer token, or null when not signed in. */
async function cgptToken() {
  try {
    const r = await fetch('/api/auth/session', { credentials: 'include' });
    if (!r.ok) return null;
    const j = await r.json();
    return (j && j.accessToken) || null;
  } catch (e) {
    return null;
  }
}

/** The `/api/auth/session` payload (user identity + token), or null. */
async function cgptSession() {
  try {
    const r = await fetch('/api/auth/session', { credentials: 'include' });
    if (!r.ok) return null;
    const j = await r.json();
    // A signed-out session is `{}` with HTTP 200 — not an error, just empty.
    return j && j.accessToken ? j : null;
  } catch (e) {
    return null;
  }
}

/**
 * GET/POST a backend-api path as the logged-in user.
 * Resolves to {ok:true, data} or {ok:false, error, hint, status}.
 */
async function cgptApi(path, opts) {
  opts = opts || {};
  const token = opts.token || (await cgptToken());
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: 'Not signed in to chatgpt.com',
      hint: 'Open https://chatgpt.com in this browser and sign in, then retry.',
    };
  }
  const headers = {
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json',
  };
  let r;
  try {
    r = await fetch(path, {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    return { ok: false, status: 0, error: 'Network error: ' + String(e) };
  }
  if (r.status === 429) {
    return {
      ok: false,
      status: 429,
      error: 'chatgpt.com rate-limited this account (HTTP 429)',
      hint:
        'Back off for a few minutes — do not poll. Running more than one ' +
        'chatgpt.com tab or automation against one account causes this.',
    };
  }
  if (r.status === 401 || r.status === 403) {
    return {
      ok: false,
      status: r.status,
      error: 'HTTP ' + r.status + ' — session rejected',
      hint: 'The page token expired or the account lacks access. Reload chatgpt.com.',
    };
  }
  if (!r.ok) {
    return { ok: false, status: r.status, error: 'HTTP ' + r.status + ' for ' + path };
  }
  try {
    return { ok: true, data: await r.json() };
  } catch (e) {
    return { ok: false, status: r.status, error: 'Malformed JSON from ' + path };
  }
}

/**
 * True when the page is showing ChatGPT's "Too many requests" dialog. A
 * DOM-level twin of the 429 above: the dialog appears without any API call of
 * ours failing, and it means the surface is dead for minutes. Adapters that
 * touch the page should check this before doing anything slow.
 */
function cgptRateLimitedDialog() {
  try {
    const text = [...document.querySelectorAll('[role="dialog"]')]
      .map((d) => d.textContent || '')
      .join(' ');
    return /too many requests|requests too quickly/i.test(text);
  } catch (e) {
    return false;
  }
}

/** Clamp a user-supplied count into [1, max], falling back to `dflt`. */
function cgptCount(raw, dflt, max) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return dflt;
  return Math.min(n, max);
}
