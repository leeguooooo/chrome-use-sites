/* @meta
{
  "name": "sggit/pr-merge",
  "description": "Merge a pull request on our self-hosted Gogs (sg-git.pwtk.cc). Runs as you, in your logged-in tab; posts the merge form the way the web UI does. Intended for the dev PR (auto-merge); use with care on feature-test/main.",
  "domain": "sg-git.pwtk.cc",
  "args": {
    "pr": {"required": true, "description": "PR number, e.g. 134"},
    "repo": {"required": false, "description": "owner/name (default: ka-cn/super-admin)"},
    "style": {"required": false, "description": "merge style: create_merge_commit (default) | rebase | squash — must be enabled on the server"},
    "message": {"required": false, "description": "extra commit description"}
  },
  "capabilities": ["network"],
  "readOnly": false,
  "example": "chrome-use site sggit/pr-merge --pr 134"
}
*/
async function (args) {
  const repo = (args.repo || 'ka-cn/super-admin').replace(/^\/+|\/+$/g, '');
  const idx = String(args.pr != null ? args.pr : (args.number != null ? args.number : '')).replace(/^#/, '').trim();
  if (!/^\d+$/.test(idx)) return { error: 'Missing/invalid argument: pr', hint: 'PR number, e.g. --pr 134 (or positional: site sggit/pr-merge 134)' };
  const style = args.style || 'create_merge_commit';

  const origin = location.origin; // https://sg-git.pwtk.cc
  const prUrl = origin + '/' + repo + '/pulls/' + idx;

  const g = await fetch(prUrl, { credentials: 'include', headers: { Accept: 'text/html' } });
  if (g.status === 404) return { error: 'PR not found: ' + repo + '#' + idx };
  if (g.status === 401 || g.status === 403) return { error: 'HTTP ' + g.status, hint: 'Not logged in to Gogs (or WARP not connected)' };
  const html = await g.text();

  const mergeable = /can be merged automatically/i.test(html);
  const alreadyMerged = /has been merged|已被合并/i.test(html) && !mergeable;
  if (alreadyMerged) return { ok: true, already: true, merged: true, number: Number(idx), url: prUrl };
  if (/can't be merged automatically|cannot be merged|there are conflicts|存在冲突/i.test(html))
    return { error: 'PR has conflicts — cannot auto-merge', number: Number(idx), url: prUrl, hint: 'resolve conflicts manually' };
  if (!mergeable)
    return { error: 'No merge form available', number: Number(idx), url: prUrl, hint: 'PR may be closed/already merged, or you lack merge permission' };

  // csrf is session-global; any _csrf input on the page carries the same token.
  const csrf = (html.match(/name="_csrf"\s+value="([^"]+)"/i) || html.match(/name="_csrf"[^>]*\bvalue="([^"]+)"/i) || [])[1];
  if (!csrf) return { error: 'CSRF token not found', hint: 'Not logged in to Gogs?' };

  const body = new URLSearchParams();
  body.set('_csrf', csrf);
  body.set('merge_style', style);
  body.set('commit_description', args.message || '');

  const p = await fetch(prUrl + '/merge', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: prUrl },
    body: body.toString(),
    redirect: 'follow'
  });

  // Verify the PR is now merged.
  const after = await (await fetch(prUrl, { credentials: 'include' })).text();
  if (/has been merged|已被合并/i.test(after) && !/can be merged automatically/i.test(after))
    return { ok: true, merged: true, number: Number(idx), url: prUrl, style };

  return { error: 'Merge did not complete (PR still not merged)', status: p.status, number: Number(idx), url: p.url || prUrl };
}
