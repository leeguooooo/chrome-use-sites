/* @meta
{
  "name": "chatgpt/open-project",
  "description": "Open any ChatGPT Project by name in this tab, so the next chat starts inside it; optionally create it",
  "domain": "chatgpt.com",
  "args": {
    "name": {"required": false, "description": "Project display name, exact and case-sensitive (this or --id)"},
    "id": {"required": false, "description": "Project gizmo id (g-p-…); skips the name lookup"},
    "create": {"required": false, "description": "`true` to create the project when none has this name"}
  },
  "capabilities": ["network"],
  "readOnly": false,
  "example": "chrome-use site chatgpt/open-project --name \"Blog illustrations\""
}
*/

// Entering a project is how a conversation gets filed under it from the start,
// so anything that automates chatgpt.com on behalf of a project needs this
// step. It is the same one chatgpt-use performs for its own project, made
// generic: the project is whatever --name says.
//
// Two details matter. The sidebar link is clicked in place when it is there:
// an SPA route costs one backend request, a full navigation about forty-five,
// and the account throttle counts requests. And only the link to the project
// PAGE counts. The sidebar also lists conversations inside the project, whose
// hrefs contain the same gizmo id, and clicking one of those would open an old
// conversation instead of a fresh chat in the project.
async function(args) {
  args = args || {};
  if (cgptRateLimitedDialog()) {
    return {
      error: 'chatgpt.com is showing its "Too many requests" dialog',
      hint: 'Back off for a few minutes before opening anything; every request extends it.',
    };
  }

  const name = args.name == null ? '' : String(args.name);
  let id = String(args.id || '').trim();
  if (!id && !name) {
    return { error: 'Missing project', hint: 'Pass --name "<project name>" or --id g-p-…' };
  }

  let created = false;
  if (!id) {
    const res = await cgptApi('/backend-api/gizmos/snorlax/sidebar?conversations_per_gizmo=0');
    if (!res.ok) return { error: res.error, hint: res.hint, status: res.status };
    let count = 0;
    for (const item of (res.data && res.data.items) || []) {
      const g = item && item.gizmo && item.gizmo.gizmo;
      if (!g || !g.id) continue;
      count++;
      if (g.display && g.display.name === name) {
        id = g.id;
        break;
      }
    }
    if (!id) {
      if (!(args.create === true || String(args.create) === 'true')) {
        return {
          error: 'No project named ' + JSON.stringify(name),
          hint:
            'Matching is exact and case-sensitive; ' + count + ' project(s) exist (see ' +
            '`chrome-use site chatgpt/projects`). Pass --create true to make it.',
        };
      }
      const mk = await cgptApi('/backend-api/projects', {
        method: 'POST',
        body: { name: name, instructions: '' },
      });
      if (!mk.ok) return { error: 'Could not create the project: ' + mk.error, hint: mk.hint, status: mk.status };
      const j = mk.data || {};
      id = (j.gizmo && (j.gizmo.id || (j.gizmo.gizmo && j.gizmo.gizmo.id))) || j.id || '';
      if (!id) {
        return {
          error: 'Created the project, but the response carried no id',
          hint: 'It should now be listed by `chrome-use site chatgpt/projects`.',
        };
      }
      created = true;
    }
  }

  const url = 'https://chatgpt.com/g/' + id + '/project';
  const result = { ok: true, id: id, name: name || null, url: url, created: created };
  const link = [...document.querySelectorAll('a[href*="/g/"]')].find((a) => {
    const href = a.getAttribute('href') || '';
    return href.includes(id) && /\/project\/?$/.test(href);
  });
  if (link) {
    link.click();
    return Object.assign(result, { opened: 'in_place' });
  }
  document.location.assign(url);
  return Object.assign(result, { opened: 'navigate' });
}
