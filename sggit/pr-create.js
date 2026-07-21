/* @meta
{
  "name": "sggit/pr-create",
  "description": "Create a pull request on our self-hosted Gogs (sg-git.pwtk.cc). Runs as you, in your logged-in tab; posts the compare form the way the web UI does.",
  "domain": "sg-git.pwtk.cc",
  "args": {
    "base": {"required": true, "description": "Target branch: dev | feature-test | main"},
    "head": {"required": true, "description": "Source branch, e.g. feat/leo/xxx"},
    "title": {"required": true, "description": "PR title"},
    "body": {"required": false, "description": "PR description (markdown)"},
    "repo": {"required": false, "description": "owner/name (default: ka-cn/super-admin)"}
  },
  "capabilities": ["network"],
  "readOnly": false,
  "example": "chrome-use site sggit/pr-create --base main --head feat/leo/foo --title \"feat: foo\" --body \"...\""
}
*/
async function (args) {
  const repo = (args.repo || 'ka-cn/super-admin').replace(/^\/+|\/+$/g, '');
  if (!args.base) return { error: 'Missing argument: base', hint: 'dev | feature-test | main' };
  if (!args.head) return { error: 'Missing argument: head' };
  if (!args.title) return { error: 'Missing argument: title' };
  if (args.base === args.head)
    return { error: 'base and head are the same branch (' + args.base + ')', hint: 'Gogs would create an empty PR — refusing.' };

  const origin = location.origin; // https://sg-git.pwtk.cc
  const comparePath = '/' + repo + '/compare/' + args.base + '...' + args.head;
  const compareUrl = origin + comparePath;

  const getCsrf = (html) => {
    let m = html.match(/name="_csrf"[^>]*\bvalue="([^"]+)"/i);
    if (m) return m[1];
    m = html.match(/\bvalue="([^"]+)"[^>]*name="_csrf"/i);
    return m ? m[1] : null;
  };

  // 1) CSRF token — Gogs csrf is session-global, so grab it from the light repo home
  //    page instead of downloading a potentially huge compare diff.
  const homeResp = await fetch(origin + '/' + repo, { credentials: 'include', headers: { Accept: 'text/html' } });
  if (homeResp.status === 401 || homeResp.status === 403)
    return { error: 'HTTP ' + homeResp.status, hint: 'Not logged in to Gogs (or WARP not connected)' };
  if (homeResp.status === 404) return { error: 'Repo not found: ' + repo };
  const csrf = getCsrf(await homeResp.text());
  if (!csrf) return { error: 'CSRF token not found', hint: 'Not logged in to Gogs?' };

  // 2) POST the compare form exactly like the "Create Pull Request" button.
  const body = new URLSearchParams();
  body.set('_csrf', csrf);
  body.set('title', args.title);
  body.set('content', args.body || '');
  body.set('label_ids', '');
  body.set('milestone_id', '0');
  body.set('assignee_id', '0');

  const resp = await fetch(compareUrl, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: compareUrl },
    body: body.toString(),
    redirect: 'follow'
  });

  const finalUrl = resp.url || '';
  const prMatch = finalUrl.match(/\/pulls\/(\d+)/);
  if (prMatch) {
    return { ok: true, number: Number(prMatch[1]), url: finalUrl, repo, base: args.base, head: args.head, title: args.title };
  }

  // Failure: Gogs re-rendered the compare page. Surface the most useful reason.
  const text = await resp.text();
  if (/branches are equal|has no changes|nothing to compare/i.test(text))
    return { error: 'No changes between branches', hint: '"' + args.head + '" has no commits ahead of "' + args.base + '"' };
  if (/pull request .*already exists|已经存在/i.test(text))
    return { error: 'A pull request for these branches already exists', url: finalUrl };
  const em = (text.match(/class="ui[^"]*negative[^"]*message"[^>]*>([\s\S]*?)<\/div>/i) || [])[1];
  return {
    error: 'PR not created (still on compare page)',
    status: resp.status,
    detail: em ? em.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) : undefined,
    url: finalUrl
  };
}
