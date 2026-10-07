/* @meta
{
  "name": "chatgpt/images",
  "description": "List the images ChatGPT generated in one conversation, each with a fresh download URL",
  "domain": "chatgpt.com",
  "args": {
    "id": {"required": true, "description": "Conversation UUID, or a https://chatgpt.com/c/<id> URL (also works for a project's /g/<gizmo>/c/<id> form)"},
    "last": {"required": false, "description": "`true` to keep only images from the latest turn (after the last user message)"},
    "uploads": {"required": false, "description": "`true` to also list images the user attached, not just generated ones"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "chrome-use site chatgpt/images https://chatgpt.com/c/6aa20b3f-c6fc-83e8-9007-e1e3d3a8eb3d"
}
*/

// Why this adapter exists: a scripted image run can give up before ChatGPT is
// done (the image renders minutes after the text turn), and the picture then
// sits in the conversation with nobody to collect it. Re-prompting spends quota
// a second time. This reads what the server already holds and hands back a URL
// per image, so the caller downloads the existing result instead.
//
// The DOM is the wrong source for that: generated <img> srcs are short-lived
// blob: URLs since the 2026-09 redesign, and the page only renders the visible
// part of a long thread. The conversation payload names every image by file id.
//
// Download URLs are signed and expire, so they are minted per call and should
// be fetched straight away, from this tab (they need the session cookies).
async function(args) {
  args = args || {};
  const on = (v) => v === true || v === 'true';

  const raw = String(args.id || '').trim();
  if (!raw) return { error: 'Missing conversation id', hint: 'Pass a UUID or a chatgpt.com/c/<id> URL.' };
  const m = raw.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  const id = m ? m[1] : raw;

  const token = await cgptToken();
  const res = await cgptApi('/backend-api/conversation/' + encodeURIComponent(id), { token: token });
  if (!res.ok) {
    if (res.status === 404) {
      return { error: 'No conversation ' + id, hint: 'Wrong id, it was deleted, or it belongs to another account.', status: 404 };
    }
    return { error: res.error, hint: res.hint, status: res.status };
  }

  const data = res.data || {};
  const mapping = data.mapping || {};

  // Live branch only (see chatgpt/conversation): a regenerated reply leaves the
  // old image in a dead branch, and that is not the one the user is looking at.
  const chain = [];
  const seen = new Set();
  let cursor = data.current_node;
  while (cursor && mapping[cursor] && !seen.has(cursor)) {
    seen.add(cursor);
    chain.push(mapping[cursor]);
    cursor = mapping[cursor].parent;
  }
  chain.reverse();

  let lastUser = -1;
  chain.forEach((node, i) => {
    const msg = node.message;
    if (msg && msg.author && msg.author.role === 'user' && msg.weight !== 0) lastUser = i;
  });

  const found = [];
  chain.forEach((node, i) => {
    const msg = node.message;
    if (!msg || !msg.author) return;
    const parts = (msg.content && Array.isArray(msg.content.parts)) ? msg.content.parts : [];
    const uploaded = msg.author.role === 'user';
    if (uploaded && !on(args.uploads)) return;
    if (on(args.last) && i <= lastUser) return;
    for (const p of parts) {
      if (!p || typeof p !== 'object' || p.content_type !== 'image_asset_pointer') continue;
      const pointer = String(p.asset_pointer || '');
      // sediment://file_… (current) or file-service://file-… (older chats).
      const fileId = pointer.replace(/^[a-z-]+:\/\//i, '');
      if (!fileId) continue;
      const meta = p.metadata || {};
      const gen = meta.generation || meta.dalle || {};
      found.push({
        file_id: fileId,
        source: uploaded ? 'uploaded' : 'generated',
        width: p.width || null,
        height: p.height || null,
        size_bytes: p.size_bytes || null,
        gen_id: gen.gen_id || null,
        prompt: (meta.dalle && meta.dalle.prompt) || null,
        created: msg.create_time || null,
        message_id: msg.id || null,
      });
    }
  });

  // Mint a signed URL per image. The current endpoint takes the file id as a
  // path segment plus the conversation; older file-service ids answer on the
  // legacy /files/<id>/download form instead, so try that before giving up.
  const cid = data.conversation_id || id;
  for (const img of found) {
    let r = await cgptApi('/backend-api/files/download/' + encodeURIComponent(img.file_id) +
      '?conversation_id=' + encodeURIComponent(cid) + '&inline=false', { token: token });
    if (r.status === 429) return { error: r.error, hint: r.hint, status: 429 };
    if (!(r.ok && r.data && r.data.download_url)) {
      const legacy = await cgptApi('/backend-api/files/' + encodeURIComponent(img.file_id) + '/download', { token: token });
      if (legacy.status === 429) return { error: legacy.error, hint: legacy.hint, status: 429 };
      if (legacy.ok && legacy.data && legacy.data.download_url) r = legacy;
    }
    if (r.ok && r.data && r.data.download_url) {
      img.download_url = r.data.download_url;
      if (r.data.file_name) img.file_name = r.data.file_name;
    } else {
      img.download_url = null;
      img.download_error = (r.data && (r.data.error_code || r.data.status)) || r.error || 'no download_url';
    }
  }

  // Whether the server is done with the conversation. An image that is still
  // rendering is not in the payload yet, so an empty list with finished:false
  // means "look again later", not "there is no image".
  const tail = chain.length ? chain[chain.length - 1].message : null;
  // The image tool's own message does not always carry end_turn, so "finished"
  // is: nothing async on the server, and the tail is a reply that completed.
  const finished = data.async_status == null && !!tail && !!tail.author &&
    tail.author.role !== 'user' && (tail.end_turn === true || tail.status === 'finished_successfully');

  return {
    id: cid,
    title: data.title || null,
    url: 'https://chatgpt.com/c/' + cid,
    finished: finished,
    async_status: data.async_status ?? null,
    count: found.length,
    images: found,
  };
}
