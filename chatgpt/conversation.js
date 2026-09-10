/* @meta
{
  "name": "chatgpt/conversation",
  "description": "Read one ChatGPT conversation's messages from the server, as the account sees them",
  "domain": "chatgpt.com",
  "args": {
    "id": {"required": true, "description": "Conversation UUID, or a https://chatgpt.com/c/<id> URL (also works for a project's /g/<gizmo>/c/<id> form)"},
    "limit": {"required": false, "description": "Keep only the last N messages (default: all)"},
    "all": {"required": false, "description": "`true` to include reasoning recaps and other chrome the UI hides"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "chrome-use site chatgpt/conversation 6aa20b3f-c6fc-83e8-9007-e1e3d3a8eb3d"
}
*/

// Why this adapter exists: it is the server's answer to "is that turn finished,
// and what did it actually say". Scraping the rendered DOM has to infer both —
// it waits for the page to stop changing and then reads whatever is on screen,
// which mistakes a mid-stream pause for an ending and a stale bubble for a new
// reply. `end_turn` on the last assistant message says so outright.
//
// The mapping is a TREE, not a list: editing a prompt or regenerating a reply
// forks it, and the dead branches stay in the payload. Walking every node would
// mix abandoned drafts into the transcript. `current_node` is the leaf of the
// live branch, so the real thread is that node's parent chain, reversed.
async function(args) {
  args = args || {};

  const raw = String(args.id || '').trim();
  if (!raw) return { error: 'Missing conversation id', hint: 'Pass a UUID or a chatgpt.com/c/<id> URL.' };
  // Accept a pasted URL in either form: /c/<id> or /g/<gizmo>/c/<id>.
  const m = raw.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  const id = m ? m[1] : raw;

  const res = await cgptApi('/backend-api/conversation/' + encodeURIComponent(id));
  if (!res.ok) {
    if (res.status === 404) {
      return { error: 'No conversation ' + id, hint: 'Wrong id, or it belongs to another account.', status: 404 };
    }
    return { error: res.error, hint: res.hint, status: res.status };
  }

  const data = res.data || {};
  const mapping = data.mapping || {};

  // Walk the live branch: current_node up to the root, then reverse.
  const chain = [];
  const seen = new Set();
  let cursor = data.current_node;
  while (cursor && mapping[cursor] && !seen.has(cursor)) {
    seen.add(cursor);
    chain.push(mapping[cursor]);
    cursor = mapping[cursor].parent;
  }
  chain.reverse();

  const messages = [];
  for (const node of chain) {
    const msg = node.message;
    if (!msg || !msg.author) continue;          // the synthetic root carries none
    if (msg.weight === 0) continue;             // weight 0 is hidden from the user
    const content = msg.content || {};
    const type = content.content_type || null;
    const text = cgptMessageText(content);
    const decoration = type === 'reasoning_recap' || type === 'thoughts';
    if (!args.all || args.all === 'false') {
      if (decoration) continue;                 // "Worked for 18s" and friends
      if (!text) continue;                      // empty tool placeholders
    }
    messages.push({
      role: msg.author.role,
      text: text,
      content_type: type,
      created: msg.create_time || null,
      // True on the message that ENDED a turn. This is the field that makes
      // "has it finished" a fact instead of an inference from DOM quiescence.
      end_turn: msg.end_turn === true,
      model: (msg.metadata && msg.metadata.model_slug) || null,
    });
  }

  const limit = Number(args.limit);
  const trimmed = Number.isInteger(limit) && limit > 0 ? messages.slice(-limit) : messages;

  // The answer a caller actually wants: the last assistant message that closed
  // its turn and carries real text.
  let final = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m2 = messages[i];
    if (m2.role === 'assistant' && m2.end_turn && m2.text) { final = m2; break; }
  }

  return {
    id: data.conversation_id || id,
    title: data.title || null,
    url: 'https://chatgpt.com/c/' + (data.conversation_id || id),
    created: data.create_time || null,
    updated: data.update_time || null,
    project: data.gizmo_id || null,
    model: data.default_model_slug || null,
    archived: data.is_archived === true,
    starred: data.is_starred === true,
    read_only: data.is_read_only === true,
    // Non-null while the server is still working on a turn.
    async_status: data.async_status ?? null,
    count: trimmed.length,
    messages: trimmed,
    final: final,
  };
}
