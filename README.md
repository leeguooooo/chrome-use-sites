# chrome-use-sites

The official **[chrome-use](https://github.com/leeguooooo/chrome-use) site adapter source**. It contains adapters maintained by the chrome-use project, including ones for internal or self-hosted services that do not belong in the public [`epiral/bb-sites`](https://github.com/epiral/bb-sites) community source.

A *site adapter* is a small JS function with a `/* @meta {…} */` header. `chrome-use site <name>/<cmd>` navigates to the adapter's domain **in your own logged-in tab** and runs the function there, returning structured JSON — no scraping, no screenshots, and it works behind auth/VPN because it runs as you.

chrome-use has two built-in adapter sources:

- Community: [`epiral/bb-sites`](https://github.com/epiral/bb-sites)
- Official: [`leeguooooo/chrome-use-sites`](https://github.com/leeguooooo/chrome-use-sites)

Both are fetched automatically on first use and by `chrome-use site update`. No `site add` or separate installer is required in versions containing [chrome-use#133](https://github.com/leeguooooo/chrome-use/pull/133).

## Install and update

```sh
chrome-use site update
chrome-use site sources
chrome-use site list | grep '^sggit/'
```

For chrome-use v1.5.77 and earlier, use the legacy installer:

```sh
curl -fsSL https://raw.githubusercontent.com/leeguooooo/chrome-use-sites/main/install.sh | sh
```

Adapters run in your logged-in browser tab, so **sign in to the target site first** (and connect VPN/WARP if it's internal).

## Packs

### `twitter/` — X search and conversation threads

The official Twitter adapters return a stable engagement schema. Every tweet
includes `likes`, `retweets`, `replies`, `bookmarks`, and numeric `views`.
When X omits or restricts a metric, its value is `null`.

```sh
chrome-use site twitter/search "chrome-use" --count 20
chrome-use site twitter/thread 2048506314163458106
```

### `sggit/` — self-hosted Gogs (`sg-git.pwtk.cc`)

One-command pull requests on our internal Gogs, instead of clicking through the compare page.

```sh
# create a PR (the 3-PR flow: run once per base)
chrome-use site sggit/pr-create --base dev          --head feat/leo/xxx --title "feat: xxx" --body "..."
chrome-use site sggit/pr-create --base feature-test --head feat/leo/xxx --title "feat: xxx" --body "..."
chrome-use site sggit/pr-create --base main         --head feat/leo/xxx --title "feat: xxx" --body "..."

# merge a PR (the dev one auto-merges in our flow)
chrome-use site sggit/pr-merge --pr 134

# list PRs
chrome-use site sggit/pr-list ka-cn/super-admin closed   # positional
chrome-use site sggit/pr-list --status all               # or a flag
```

`repo` defaults to `ka-cn/super-admin`. `pr-create` returns `{ ok, number, url }` on success.

| adapter | args | notes |
| --- | --- | --- |
| `sggit/pr-create` | `--base --head --title [--body] [--repo]` | POSTs the Gogs compare form (`_csrf`+`title`+`content`); 302 → the new PR. Refuses `base==head` (Gogs would otherwise create an empty PR). |
| `sggit/pr-list` | `[repo] [status]` / `--status open\|closed\|all` | Parses the `/pulls` page. |
| `sggit/pr-merge` | `--pr <n> [--repo] [--style] [--message]` | POSTs `/pulls/<n>/merge` (`_csrf`+`merge_style`); default `create_merge_commit`. Detects conflicts / already-merged / no-permission and errors instead of half-acting. Meant for the **dev** PR — use with care on feature-test/main. |

**Gotchas** (baked into the adapters / learned the hard way):

- **`--state` is a reserved chrome-use global flag** and gets swallowed before it reaches the adapter. That's why `pr-list` uses `--status`, not `--state` — or just pass args **positionally** (they always forward). `--base/--head/--title/--body/--repo` don't collide.
- Gogs' `_csrf` is **session-global**, so the adapter reads it from the light repo home page instead of downloading a huge diff page.
- Requires **WARP connected** and a logged-in Gogs session in the browser chrome-use drives.

### `chatgpt/` — your own ChatGPT account, as structured data

Read-only queries against `chatgpt.com` using the session already in your
browser. No `OPENAI_API_KEY`: the adapters read the page's own bearer token from
`/api/auth/session`, so they bill nothing and see exactly what you see.

```sh
chrome-use site chatgpt/me
chrome-use site chatgpt/conversations --limit 10
chrome-use site chatgpt/conversations --project g-p-68bf…     # one project only
chrome-use site chatgpt/projects
chrome-use site chatgpt/projects --name "Blog illustrations"   # exact match
```

| adapter | args | notes |
| --- | --- | --- |
| `chatgpt/me` | — | Which account this browser is signed in as. Reads `/api/auth/session` **and** `/backend-api/me` (the latter answers from cookies alone, no bearer), so a live session whose token mint is broken reports `token_available: false` instead of looking healthy. |
| `chatgpt/conversations` | `[limit] [offset] [project]` | `GET /backend-api/conversations?order=updated`. `limit` clamps to 1–100 (default 20). `--project` filters on `gizmo_id` client-side — the endpoint has no project filter. |
| `chatgpt/projects` | `[name]` | Projects are "snorlax" gizmos; `GET /backend-api/gizmos/snorlax/sidebar?conversations_per_gizmo=0` is the only listing. `--name` is exact and case-sensitive; a miss tells you how many projects exist. |

**Why this pack is fetch-only, and must stay that way**

A site adapter is page JS run through `eval`. It cannot produce a *trusted*
click or keypress, and ChatGPT's composer needs both:

- `.click()` from page JS does **not** open the model picker. Only a real
  coordinate click does.
- The five intelligence levels are no longer menu items but a `[role="slider"]`
  (`aria-valuenow` 0–4), driven by arrow keys. Model *family* is a separate axis
  (`[role="menuitemradio"]`).

So "send a prompt" and "generate an image" cannot be adapters at all — they need
a CLI that can call `chrome-use click` / `chrome-use press`. Those live in
[`chatgpt-use`](https://github.com/leeguooooo/chatgpt-use) (chat turns) and
[`chatgpt-imagegen`](https://github.com/leeguooooo/chatgpt-imagegen) (images).
Adding a DOM-driving adapter here will look like it works and then fail in ways
that are hard to attribute.

**Gotchas** (learned the hard way, mostly the expensive way)

- **Run ONE chatgpt.com tab per account.** Not a style preference. ChatGPT pushes
  an "Image created" toast into *every* open chatgpt.com tab when *any*
  conversation on the account finishes an image — including one you have open by
  hand. The toast lives in a portal outside `<main>` and its thumbnail `src`
  matches the asset URL pattern, so a document-wide DOM scan silently steals
  another conversation's image. Scope every DOM read to `main …`. Two processes
  sharing one composer also concatenate their prompts.
- Because of that, `chatgpt-use` and `chatgpt-imagegen` serialize every turn on a
  shared advisory lock at **`~/.chatgpt-web.lock`** and drive a single stable
  chrome-use session named **`chatgpt-web`**. Anything new that automates
  chatgpt.com should take that same lock and session name.
- **`--model` is a reserved chrome-use global flag** and never reaches an
  adapter. Same for `--state`, `--session`, `--profile`, `--new`, `--window`,
  `--as`. Pass such args positionally, or after `--`.
- A signed-out session is **HTTP 200 with `{}`**, not an error status. Treating a
  tokenless 200 as success is why `chatgpt/me` checks for the token explicitly.
- **HTTP 429 means the account is throttled**, not that the request was bad. The
  page shows a "Too many requests" dialog and the surface stays dead for
  minutes. These adapters return a distinct `hint` telling you to back off; do
  not build a retry loop on it.
- A conversation's id appears in the URL (`/c/<uuid>`) only **after its first
  turn is persisted** — there is no id to reattach to mid-first-turn.

## Adding an adapter

Drop `packname/command.js` in this repo and follow the shape of the existing files. Current chrome-use versions discover `.js` adapters directly from the repository tree. Also add the path to `PACKS` in `install.sh` while the legacy v1.5.77 installer remains supported.

```js
/* @meta
{ "name": "packname/command", "domain": "host.example.com",
  "args": { "foo": {"required": true, "description": "…"} },
  "capabilities": ["network"], "readOnly": true }
*/
async function (args) {
  // runs in the logged-in tab on `domain`; same-origin fetch has cookies.
  return { /* structured JSON */ };
}
```

Avoid arg names that collide with chrome-use global flags (`state`, `profile`, `session`, `timeout`, `url`, `fn`, …).
