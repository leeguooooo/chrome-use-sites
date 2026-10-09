# `chatgpt/` — your own ChatGPT account, as structured data

English · [中文](README.zh.md)

Queries against `chatgpt.com` using the session already in your browser: who you are signed in as, your conversations and their messages, projects, available models, and the images a conversation generated. No `OPENAI_API_KEY`: the adapters read the page's own bearer token from `/api/auth/session`, so they bill nothing and see exactly what you see. Everything is read-only except `chatgpt/open-project`, which navigates the tab (and can create a project). You must be signed in to `chatgpt.com` in the browser chrome-use drives.

## Commands

```sh
chrome-use site chatgpt/me
chrome-use site chatgpt/conversations --limit 10
chrome-use site chatgpt/conversations --project g-p-68bf…     # one project only
chrome-use site chatgpt/conversation 6aa20b3f-c6fc-83e8-9007-e1e3d3a8eb3d
chrome-use site chatgpt/models pro
chrome-use site chatgpt/projects
chrome-use site chatgpt/projects --name "Blog illustrations"   # exact match
chrome-use site chatgpt/open-project --name "Blog illustrations"   # enter it (not read-only)
chrome-use site chatgpt/images https://chatgpt.com/c/6aa20b3f-…   # generated images + download URLs
```

## Adapters

| adapter | args | returns / does |
| --- | --- | --- |
| `chatgpt/me` | — | Which account this browser is signed in as. Reads `/api/auth/session` **and** `/backend-api/me` (the latter answers from cookies alone, no bearer). Returns `signed_in, id, email, name, country, region, auth_provider, session_expires, token_available`; a live session whose token mint is broken reports `token_available: false` instead of looking healthy. |
| `chatgpt/conversations` | `[--limit N] [--offset N] [--project g-p-…]` | `GET /backend-api/conversations?order=updated`, newest first. `limit` clamps to 1–100 (default 20). `--project` filters on `gizmo_id` client-side — the endpoint has no project filter. Returns `{ count, offset, project, conversations }`, each `id, title, url, created, updated, project, snippet, archived, starred` (`snippet` is the sidebar preview line). No `total` (see gotchas). |
| `chatgpt/conversation` | `<id\|url> [--limit N] [--all true]` | One conversation's messages from `/backend-api/conversation/<id>`. Accepts a UUID or a `/c/<id>` or `/g/<gizmo>/c/<id>` URL. Follows only the **live branch** (`current_node` up its parent chain), so edited or regenerated drafts are left out. Hidden messages, reasoning recaps and empty tool placeholders are dropped unless `--all true`; `--limit` keeps the last N. Returns `id, title, url, created, updated, project, model, archived, starred, read_only, async_status, count, messages, final`; each message is `role, text, content_type, created, end_turn, model`. `end_turn: true` marks the message that ended a turn; `final` is the last assistant message that ended its turn with text. `async_status` is non-null while the server is still working. |
| `chatgpt/models` | `[slug] [--efforts true]` | `/backend-api/models`: the models this account can actually use. `slug` filters on slug or title, case-insensitive (pass it positionally; it is not called `model` because `--model` is reserved). Returns `default, picker_version, count, total, filter, models, categories`. Each model: `slug, title, description, max_tokens, reasoning_type, configurable_thinking_effort, thinking_effort_count, tags`, plus `thinking_efforts` (`effort, label, description`) with `--efforts true`. Each category: `category, name, short_name, default_model, subscription_level, tagline`. |
| `chatgpt/projects` | `[--name <exact name>]` | Projects are "snorlax" gizmos; `GET /backend-api/gizmos/snorlax/sidebar?conversations_per_gizmo=0` is the only listing. Returns `{ count, projects }`, each `id, name, description, url, updated, default_model`. `--name` is exact and case-sensitive; a miss tells you how many projects exist. |
| `chatgpt/open-project` | `--name <project> \| --id <g-p-…> [--create true]` | **Not read-only**: navigates this tab into a Project so the next chat is filed under it from the start. Clicks the sidebar link in place when present (one backend request instead of ~45 for a reload), and only the link to the project **page**, never a conversation inside it; otherwise navigates to `/g/<id>/project`. Resolves the name exactly like `chatgpt/projects`; creates the project only with `--create true`. Refuses while the "Too many requests" dialog is up. Returns `{ ok, id, name, url, created, opened }` with `opened` = `in_place` or `navigate`. |
| `chatgpt/images` | `<id\|url> [--last true] [--uploads true]` | Images ChatGPT generated in one conversation (live branch only), each with a signed `download_url` from `/backend-api/files/download/<file_id>` (legacy `/files/<id>/download` for old `file-service://` ids). Collects a result that a script gave up on before it rendered, without prompting again. `--last true` keeps only the latest turn; `--uploads true` adds the user's attached images. Returns `id, title, url, finished, async_status, count, images`; each image `file_id, source, width, height, size_bytes, gen_id, prompt, created, message_id, download_url` (`source` is `generated` or `uploaded`; plus `file_name`, or `download_error` when no URL could be minted). URLs expire: fetch them right away, from this tab. `finished: false` with no images means the server is still working, not that there is no image. |

`chatgpt/images` was live-checked on 2026-10-07 through `image-use recover` (5 generated PNGs from a `sediment://` conversation); the legacy `file-service://` fallback is still unverified.

The adapters share `chatgpt/_helper.js` (token, fetch, error mapping). A 401/403 means not signed in or the token expired; a 429 gets its own error and `hint` (see below).

## Why this pack is fetch-only, and must stay that way

A site adapter is page JS run through `eval`. It cannot produce a *trusted* click or keypress, and ChatGPT's composer needs both:

- `.click()` from page JS does **not** open the model picker. Only a real coordinate click does.
- The five intelligence levels are no longer menu items but a `[role="slider"]` (`aria-valuenow` 0–4), driven by arrow keys. Model *family* is a separate axis (`[role="menuitemradio"]`).

So "send a prompt" and "generate an image" cannot be adapters at all — they need a CLI that can call `chrome-use click` / `chrome-use press`. Those live in [`chatgpt-use`](https://github.com/leeguooooo/chatgpt-use) (chat turns) and [`chatgpt-imagegen`](https://github.com/leeguooooo/chatgpt-imagegen) (images). Adding a DOM-driving adapter here will look like it works and then fail in ways that are hard to attribute.

## Gotchas

- **Run ONE chatgpt.com tab per account.** ChatGPT pushes an "Image created" toast into *every* open chatgpt.com tab when *any* conversation on the account finishes an image. The toast lives in a portal outside `<main>` and its thumbnail `src` matches the asset URL pattern, so a document-wide DOM scan silently steals another conversation's image. Scope every DOM read to `main …`. Two processes sharing one composer also concatenate their prompts.
- Because of that, `chatgpt-use` and `chatgpt-imagegen` serialize every turn on a shared advisory lock at **`~/.chatgpt-web.lock`** and drive a single stable chrome-use session named **`chatgpt-web`**. Anything new that automates chatgpt.com should take that same lock and session name.
- **`--model` is a reserved chrome-use global flag** and never reaches an adapter. Same for `--state`, `--session`, `--profile`, `--new`, `--window`, `--as`. Pass such args positionally, or after `--`.
- A signed-out session is **HTTP 200 with `{}`**, not an error status. That is why `chatgpt/me` checks for the token explicitly.
- **HTTP 429 means the account is throttled**, not that the request was bad. The page shows a "Too many requests" dialog and the surface stays dead for minutes. These adapters return a distinct `hint` telling you to back off; do not build a retry loop on it.
- **`/backend-api/conversations` returns a `total`, and it is not account-wide.** Measured: `limit=3` reported `total: 4` on an account whose sidebar lists ~28 conversations. Paging until `offset >= total` stops after the second page, so `chatgpt/conversations` deliberately does not expose it. A short page — fewer rows than `limit` — is the real end-of-list signal.
- On `/backend-api/me` the country key is **`country`**; `geoip_country` does not exist.
- On a snorlax gizmo the timestamp is **`updated_at`**; `update_time` does not exist (it is the *conversation* endpoint that uses `update_time`).
- A conversation's id appears in the URL (`/c/<uuid>`) only **after its first turn is persisted** — there is no id to reattach to mid-first-turn.

## Safety / testing

**Never test these adapters against the live ChatGPT.** Do not run `chrome-use site chatgpt/*`, or open chatgpt.com in scratch sessions, to check an adapter. They run in your own signed-in browser, and chatgpt.com throttles the account by **request count**: a full page load is about 45 backend requests, and scripted live checks have already tripped "Too many requests" on the account in daily use.

Verify offline instead. The tests load each adapter the way chrome-use does (with `_helper.js` in scope) against stubbed `fetch` and `document`; see `loadAdapter` and `router` in `chatgpt/adapters.test.js`. New behaviour gets a stubbed test there. If something can only be confirmed live, say so in the PR and leave it unverified.

## Tests

`node --test chatgpt/`

See [CHANGELOG](../CHANGELOG.md) for changes.
