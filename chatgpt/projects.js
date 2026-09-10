/* @meta
{
  "name": "chatgpt/projects",
  "description": "List ChatGPT Projects (folders) on this account",
  "domain": "chatgpt.com",
  "args": {
    "name": {"required": false, "description": "Only the project whose display name matches exactly"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "chrome-use site chatgpt/projects"
}
*/

async function(args) {
  args = args || {};
  // Projects are "snorlax" gizmos internally — the sidebar endpoint is the only
  // one that lists them. conversations_per_gizmo=0 keeps the response small;
  // without it the server attaches a conversation preview per project.
  const res = await cgptApi(
    '/backend-api/gizmos/snorlax/sidebar?conversations_per_gizmo=0'
  );
  if (!res.ok) return { error: res.error, hint: res.hint, status: res.status };

  const items = (res.data && res.data.items) || [];
  const projects = [];
  for (const item of items) {
    // Doubly nested on purpose: the sidebar wraps a gizmo envelope around the
    // gizmo itself (item.gizmo.gizmo). Skip anything that doesn't match that
    // shape rather than emitting half-built rows.
    const g = item && item.gizmo && item.gizmo.gizmo;
    if (!g || !g.id) continue;
    projects.push({
      id: g.id,
      name: (g.display && g.display.name) || null,
      description: (g.display && g.display.description) || null,
      url: 'https://chatgpt.com/g/' + g.id + '/project',
      updated: g.updated_at || null,
    });
  }

  if (args.name) {
    const wanted = String(args.name);
    const hit = projects.find((p) => p.name === wanted);
    if (!hit) {
      return {
        error: 'No project named ' + JSON.stringify(wanted),
        hint:
          'Run `chrome-use site chatgpt/projects` to see the ' +
          projects.length +
          ' project(s) on this account. Matching is exact and case-sensitive.',
        count: 0,
        projects: [],
      };
    }
    return { count: 1, projects: [hit] };
  }

  return { count: projects.length, projects };
}
