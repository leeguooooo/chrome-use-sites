/* @meta
{
  "name": "chatgpt/me",
  "description": "Which ChatGPT account this browser is signed in as",
  "domain": "chatgpt.com",
  "args": {},
  "capabilities": ["network"],
  "readOnly": true,
  "example": "chrome-use site chatgpt/me"
}
*/

async function(args) {
  // Two sources, deliberately. /api/auth/session is the page's own session
  // endpoint and the only place the bearer token exists; /backend-api/me
  // answers WITHOUT a bearer (cookies alone) and adds the account id and
  // country. Asking both distinguishes "signed out" from "signed in but the
  // token mint is broken", which otherwise look identical.
  const session = await cgptSession();

  let account = null;
  try {
    const r = await fetch('/backend-api/me', { credentials: 'include' });
    if (r.ok) account = await r.json();
  } catch (e) {
    account = null;
  }

  if (!session && !account) {
    return {
      error: 'Not signed in to chatgpt.com',
      hint: 'Open https://chatgpt.com in this browser and sign in, then retry.',
    };
  }

  const user = (session && session.user) || {};
  return {
    signed_in: !!session,
    id: account && account.id ? account.id : user.id || null,
    email: (account && account.email) || user.email || null,
    name: user.name || null,
    country: (account && (account.geoip_country || account.country)) || null,
    auth_provider: (session && session.authProvider) || null,
    session_expires: (session && session.expires) || null,
    // A signed-in cookie jar whose token mint fails still can't call
    // backend-api — say so rather than reporting a healthy-looking account.
    token_available: !!(session && session.accessToken),
  };
}
