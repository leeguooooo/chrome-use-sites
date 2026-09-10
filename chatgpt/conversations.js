/* @meta
{
  "name": "chatgpt/conversations",
  "description": "List recent ChatGPT conversations, newest first",
  "domain": "chatgpt.com",
  "args": {
    "limit": {"required": false, "description": "How many to return (default 20, max 100)"},
    "offset": {"required": false, "description": "Skip this many before listing (default 0)"},
    "project": {"required": false, "description": "Only conversations in this project gizmo id (g-p-...)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "chrome-use site chatgpt/conversations --limit 10"
}
*/

async function(args) {
  args = args || {};
  const limit = cgptCount(args.limit, 20, 100);
  const offsetRaw = Number(args.offset);
  const offset = Number.isInteger(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;

  const qs =
    'offset=' + offset + '&limit=' + limit + '&order=updated';
  const res = await cgptApi('/backend-api/conversations?' + qs);
  if (!res.ok) return { error: res.error, hint: res.hint, status: res.status };

  const items = (res.data && res.data.items) || [];
  // `gizmo_id` is how a conversation says "I live inside this project". The
  // server has no project filter on this endpoint, so filter client-side.
  const wanted = args.project ? String(args.project) : null;
  const filtered = wanted ? items.filter((c) => c.gizmo_id === wanted) : items;

  return {
    count: filtered.length,
    // The server's own total, so a caller can page without guessing whether a
    // short page means "end of list" or "filtered".
    total: (res.data && res.data.total) != null ? res.data.total : null,
    offset: offset,
    project: wanted,
    conversations: filtered.map((c) => ({
      id: c.id,
      title: c.title || null,
      url: 'https://chatgpt.com/c/' + c.id,
      created: c.create_time || null,
      updated: c.update_time || null,
      project: c.gizmo_id || null,
      archived: c.is_archived === true,
    })),
  };
}
