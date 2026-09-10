/* @meta
{
  "name": "chatgpt/models",
  "description": "List the models this ChatGPT account can actually use, with their thinking-effort options",
  "domain": "chatgpt.com",
  "args": {
    "slug": {"required": false, "description": "Only models whose slug or title contains this (case-insensitive). Positional: `site chatgpt/models pro`. NOT named `model` — that is a reserved chrome-use flag."},
    "efforts": {"required": false, "description": "`true` to keep the per-model thinking-effort list (default: just a count)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "chrome-use site chatgpt/models pro"
}
*/

// Why this adapter exists: the model line-up changes under you, and anything
// that hard-codes model names goes stale silently. chatgpt-use shipped a
// whitelist of composer labels and it broke twice in three weeks — once when a
// label became "5.6 SolLight", once when the levels stopped being menu items at
// all. `/backend-api/models` is the account's own answer to "what can I ask
// for right now", so a caller can validate a --model value instead of guessing.
async function(args) {
  args = args || {};

  const res = await cgptApi('/backend-api/models');
  if (!res.ok) return { error: res.error, hint: res.hint, status: res.status };

  const data = res.data || {};
  const all = data.models || [];

  const needle = args.slug ? String(args.slug).toLowerCase() : null;
  const matches = needle
    ? all.filter(
        (m) =>
          String(m.slug || '').toLowerCase().includes(needle) ||
          String(m.title || '').toLowerCase().includes(needle),
      )
    : all;

  // Keep the effort list only when asked: every reasoning model repeats the
  // same four entries, which drowns the output for the common "what slugs are
  // there" question.
  const keepEfforts = args.efforts === true || args.efforts === 'true';

  return {
    // What a fresh conversation gets if nothing is chosen.
    default: data.default_model_slug || null,
    // Bump this and assume the picker UI changed shape.
    picker_version: data.model_picker_version ?? null,
    count: matches.length,
    total: all.length,
    filter: needle,
    models: matches.map((m) => {
      const efforts = m.thinking_efforts || [];
      const row = {
        slug: m.slug,
        title: m.title || null,
        description: m.description || null,
        max_tokens: m.max_tokens ?? null,
        // "reasoning" | "pro" | absent. `pro` models cannot use Apps/MCP
        // connectors, which is the distinction that actually bites callers.
        reasoning_type: m.reasoning_type || null,
        configurable_thinking_effort: m.configurable_thinking_effort === true,
        thinking_effort_count: efforts.length,
        tags: m.tags || [],
      };
      if (keepEfforts) {
        row.thinking_efforts = efforts.map((e) => ({
          effort: e.thinking_effort,
          label: e.full_label || e.short_label || null,
          description: e.description || null,
        }));
      }
      return row;
    }),
    // The picker's top-level groupings. Note the API uses snake_case here
    // (`human_category_name`), while the browser's localStorage cache of the
    // same data uses camelCase (`label`) — read them from the API, not the cache.
    categories: (data.categories || []).map((c) => ({
      category: c.category || null,
      name: c.human_category_name || null,
      short_name: c.human_category_short_name || null,
      default_model: c.default_model || null,
      subscription_level: c.subscription_level || null,
      tagline: c.tagline || null,
    })),
  };
}
