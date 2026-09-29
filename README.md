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
chrome-use site chatgpt/open-project --name "Blog illustrations"   # enter it (not read-only)
```

| adapter | args | notes |
| --- | --- | --- |
| `chatgpt/me` | — | Which account this browser is signed in as. Reads `/api/auth/session` **and** `/backend-api/me` (the latter answers from cookies alone, no bearer), so a live session whose token mint is broken reports `token_available: false` instead of looking healthy. |
| `chatgpt/conversations` | `[limit] [offset] [project]` | `GET /backend-api/conversations?order=updated`. `limit` clamps to 1–100 (default 20). `--project` filters on `gizmo_id` client-side — the endpoint has no project filter. Returns `snippet` (the sidebar preview line), `starred`, `archived`. |
| `chatgpt/projects` | `[name]` | Projects are "snorlax" gizmos; `GET /backend-api/gizmos/snorlax/sidebar?conversations_per_gizmo=0` is the only listing. `--name` is exact and case-sensitive; a miss tells you how many projects exist. |
| `chatgpt/open-project` | `--name <project> \| --id <g-p-…> [--create true]` | **Not read-only**: navigates this tab into any Project so the next chat is filed under it from the start. Clicks the sidebar link in place when present (one backend request instead of ~45 for a reload), and only the link to the project **page**, never a conversation inside it. Resolves the name exactly like `chatgpt/projects`; creates the project only with `--create true`. Refuses while the "Too many requests" dialog is up. |

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
- **`/backend-api/conversations` returns a `total`, and it is not account-wide.**
  Measured: `limit=3` reported `total: 4` on an account whose sidebar lists ~28
  conversations. Paging until `offset >= total` stops after the second page and
  looks like a clean finish, so `chatgpt/conversations` deliberately does **not**
  expose it. A short page — fewer rows than `limit` — is the real end-of-list
  signal.
- On `/backend-api/me` the country key is **`country`**; `geoip_country` does not
  exist. `region`, `region_code` and `first_name` are also present.
- On a snorlax gizmo the timestamp is **`updated_at`**; `update_time` does not
  exist (it is the *conversation* endpoint that uses `update_time`).
- A conversation's id appears in the URL (`/c/<uuid>`) only **after its first
  turn is persisted** — there is no id to reattach to mid-first-turn.

### `xiaohongshu-creator/` — your own Xiaohongshu creator center, read-only

Reads `creator.xiaohongshu.com` (创作服务平台) as the account signed in there:
profile counts, the note manager list, and the per-note data center. The
community pack's `xiaohongshu/` covers the public site (`www.xiaohongshu.com`);
this pack covers only what the creator sees about their own account.

```sh
chrome-use site xiaohongshu-creator/me
chrome-use site xiaohongshu-creator/notes --limit 10 --tab published
chrome-use site xiaohongshu-creator/notes --page 2            # next_page from the last call
chrome-use site xiaohongshu-creator/note-stats 6abbe0ef000000001203e9c7
chrome-use site xiaohongshu-creator/note-stats "https://www.xiaohongshu.com/explore/6abbe0ef000000001203e9c7"
```

| adapter | args | notes |
| --- | --- | --- |
| `xiaohongshu-creator/me` | `[--summary false]` | `user_id`, `nickname`, `red_id`, `fans`, `follows`, `likes_and_collects` (XHS only publishes the combined 获赞与收藏), `level`, plus `data_center.last_7_days` / `last_30_days`: views, home views, impressions, likes, collects, comments, shares, new/lost/net fans, notes published. `GET /api/galaxy/creator/home/personal_info` and `/api/galaxy/v2/creator/datacenter/account/base`, sent together as the home page sends them; `--summary false` skips the second. The user id comes from the page's Vuex store, not a request. |
| `xiaohongshu-creator/notes` | `[limit] [page] [tab]` | The note manager's `GET /api/galaxy/v2/creator/note/user/posted?tab=&page=`. The server pages by 10, so `limit` (default 20, max 50) costs one request per 10. Each note: `id`, `title`, `type` (`normal`/`video`), `published_at` (+08:00), `status` / `status_text` / `status_code`, `visibility` / `visibility_text` / `visibility_code`, `pinned`, `cover`, `url` (with the `xsec_token` the manager hands out), `views`, `likes`, `collects`, `comments`, `shares`. `--tab`: `all`, `published`, `reviewing`, `rejected`, `scheduled`, or 全部/已发布/审核中/未通过/定时发布. |
| `xiaohongshu-creator/note-stats` | `<note_id> [--audience false]` | The 笔记数据 page's `GET /api/galaxy/creator/datacenter/note/base`, `…/note/audience/source` and `…/note/audience/source/detail`. `metrics`: impressions, views, cover click rate, average view time, likes, collects, comments, shares, follows gained, danmaku, interaction rate; image notes add `avg_images_viewed`, videos add full-view / 5 s finish / 2 s exit rates and 60 s plays. `traffic_sources` and `audience` (gender, age, city, interest) as `{name, pct}` lists. Only works for notes this account published. |

Status codes, as the creator bundle defines them:

| `status_code` | `status` | shown as |
| --- | --- | --- |
| 1 | `published` | 已发布 |
| 2 | `reviewing` | 审核中 |
| 3 | `rejected` | 未通过 |
| 4 | `scheduled` | 定时发布 |

`visibility_code`: 0 `public` 公开可见, 1 `private` 仅自己可见, 2 `partially_hidden`
部分人不可见, 3 `partially_visible` 部分人可见, 4 `friends_only` 仅互关好友可见.

**How it calls the API (no request signing here).** Every creator API request
carries `X-s` / `X-t` / `X-S-Common` headers, computed by the page's own HTTP
client (which calls `window._webmsxyw`). These adapters find that client in the
page's webpack registry, through a module that calls it with a known endpoint
key, and call it. So each request is built, signed and sent exactly the way the
creator center sends it. Nothing here fetches directly or reimplements the
signature, and a test fails if an adapter tries.

**Risk.** These run as you, against your real account. They are read-only
(the page client's `post` is never called) and cheap: `me` is 2 requests,
`notes` 1 per 10 notes, `note-stats` 3, the same calls the pages make when you
open them. Don't loop them, poll them, or page through every note on a timer.
XHS judges accounts by behaviour, and a script re-reading the data center every
minute does not look like a person. If an adapter returns HTTP 461 or 429,
stop. That means XHS wants a captcha or is throttling you. Open the creator
center by hand.

**Gotchas**

- **Missing metrics are `null`, never 0.** The data center reports "not
  computed yet" as `-1`. A note under a day old reads `-1` for impressions,
  view time and most rates. Image notes report `0` for the video-only rates,
  which means "n/a", so those are `null` too.
- **Audience and traffic breakdowns need an audience.** Under the threshold
  (the page says 50 viewers on one screen and 100 on another), the endpoints
  answer `noData` with a reason. That arrives as `available: false` plus
  `reason`, e.g. `"观看数不足100，暂时无法分析"`.
- **The `notes` cursor is a page number, not an offset.** The server returns
  the next page, or `-1` at the end (`next_page: null`). If `limit` cuts a
  page short, `next_page` points back at that page, so resuming repeats a few
  notes instead of skipping them. Dedupe by `id`.
- **chrome-use gives an adapter about 8 s.** `personal_info` was measured
  taking 10 s once. Each adapter works to a 7 s budget: a slow call comes back
  as `"did not answer … in time"`, and `notes` returns the pages it already
  has with `partial` set and a cursor to resume from. Retry once, not in a
  loop.
- **The page client writes the resolved URL into the options object you pass
  it.** Parallel calls that share one object all go to the last URL. The
  helper copies the config per call.
- `tab_status` (on a note) and the `tab` query parameter number their states
  differently (published is 1 and 1, but "all" is tab 0 and has no status).
  Don't feed one into the other.
- The manager's `time` is China-local `YYYY-MM-DD HH:mm` with no zone.
  `published_at` adds `+08:00`. `note-stats` uses the epoch `postTime`, so it
  has seconds too.

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
