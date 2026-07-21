/* @meta
{
  "name": "sggit/pr-list",
  "description": "List pull requests on our self-hosted Gogs (sg-git.pwtk.cc). Runs as you, in your logged-in tab.",
  "domain": "sg-git.pwtk.cc",
  "args": {
    "repo": {"required": false, "description": "owner/name (default: ka-cn/super-admin)"},
    "status": {"required": false, "description": "open | closed | all (default: open). Use --status, not --state (--state is a reserved chrome-use flag)."}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "chrome-use site sggit/pr-list ka-cn/super-admin closed  (positional)  |  chrome-use site sggit/pr-list --status all"
}
*/
async function (args) {
  const repo = (args.repo || 'ka-cn/super-admin').replace(/^\/+|\/+$/g, '');
  const status = (args.status || args.state || 'open').toLowerCase();
  // Gogs' pulls page only accepts state=open|closed; expand "all" to both.
  const states = status === 'all' ? ['open', 'closed'] : [status];

  const seen = new Set();
  const prs = [];
  for (const st of states) {
    const url = location.origin + '/' + repo + '/pulls?state=' + encodeURIComponent(st);
    const r = await fetch(url, { credentials: 'include', headers: { Accept: 'text/html' } });
    if (r.status === 404) return { error: 'Repo not found: ' + repo };
    if (r.status === 401 || r.status === 403) return { error: 'HTTP ' + r.status, hint: 'Not logged in to Gogs (or WARP not connected)' };
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    doc.querySelectorAll('a[href*="/pulls/"]').forEach((a) => {
      const m = a.getAttribute('href').match(/\/pulls\/(\d+)(?:$|[?#])/);
      if (!m) return;
      const num = Number(m[1]);
      const title = (a.textContent || '').trim();
      if (!title || seen.has(num)) return;
      seen.add(num);
      prs.push({ number: num, title, state: st, url: location.origin + a.getAttribute('href').split(/[?#]/)[0] });
    });
  }

  prs.sort((a, b) => b.number - a.number);
  return { repo, status, count: prs.length, pulls: prs };
}
