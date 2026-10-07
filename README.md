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

### `twitter/` — X search, conversation threads, and posting

The official Twitter adapters return a stable engagement schema. Every tweet
includes `likes`, `retweets`, `replies`, `bookmarks`, and numeric `views`.
When X omits or restricts a metric, its value is `null`.

```sh
chrome-use site twitter/search "chrome-use" --count 20
chrome-use site twitter/thread 2048506314163458106
```

`twitter/post` posts from the logged-in account through X's own `CreateTweet`
call (with the same transaction-id header the web app sends). The text is
checked against X's 280-character weighting first — CJK characters count 2,
every link 23 — and a refusal says nothing was posted. `--dry_run true` returns
what would be sent; `--reply_to <id|url>` posts a reply, which is how a thread
is built.

```sh
chrome-use site twitter/post --text @tweet.txt --dry_run true
chrome-use site twitter/post --text @tweet.txt
chrome-use site twitter/post --text @second.txt --reply_to https://x.com/you/status/123
chrome-use site twitter/post --text @tweet.txt --media ./clip.mp4 --timeout 5m   # native video
```

`--media` attaches a local video or image: it is uploaded the way the web
composer does (chunked INIT/APPEND/FINALIZE, then waiting for X to process a
video) before the tweet goes out, and a failed upload posts nothing.

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
chrome-use site chatgpt/images https://chatgpt.com/c/6aa20b3f-…   # generated images + download URLs
```

| adapter | args | notes |
| --- | --- | --- |
| `chatgpt/me` | — | Which account this browser is signed in as. Reads `/api/auth/session` **and** `/backend-api/me` (the latter answers from cookies alone, no bearer), so a live session whose token mint is broken reports `token_available: false` instead of looking healthy. |
| `chatgpt/conversations` | `[limit] [offset] [project]` | `GET /backend-api/conversations?order=updated`. `limit` clamps to 1–100 (default 20). `--project` filters on `gizmo_id` client-side — the endpoint has no project filter. Returns `snippet` (the sidebar preview line), `starred`, `archived`. |
| `chatgpt/projects` | `[name]` | Projects are "snorlax" gizmos; `GET /backend-api/gizmos/snorlax/sidebar?conversations_per_gizmo=0` is the only listing. `--name` is exact and case-sensitive; a miss tells you how many projects exist. |
| `chatgpt/open-project` | `--name <project> \| --id <g-p-…> [--create true]` | **Not read-only**: navigates this tab into any Project so the next chat is filed under it from the start. Clicks the sidebar link in place when present (one backend request instead of ~45 for a reload), and only the link to the project **page**, never a conversation inside it. Resolves the name exactly like `chatgpt/projects`; creates the project only with `--create true`. Refuses while the "Too many requests" dialog is up. |
| `chatgpt/images` | `<id\|url> [--last true] [--uploads true]` | Images ChatGPT generated in one conversation (live branch only), each with a signed `download_url` from `/backend-api/files/download/<file_id>` (legacy `/files/<id>/download` for old `file-service://` ids). Collects a result that a script gave up on before it rendered, without prompting again. URLs expire: fetch them right away, from this tab. `finished: false` with no images means the server is still working, not that there is no image. `--uploads` adds the user's attached references. Live-checked 2026-10-07 through `image-use recover` (5 generated PNGs from a `sediment://` conversation); the legacy `file-service://` fallback is still unverified. |

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

### `*/article-publish` — cross-post a Markdown article to Chinese dev platforms

One command per platform publishes a Markdown article as the account signed in
there, or saves a draft only. They write to your real account.

```sh
T="My title"; S="One-paragraph summary"; TAGS="Claude,Codex,AI编程,人工智能,开源"
chrome-use site juejin/article-publish       --title "$T" --markdown @post.md --summary "$S" --tags "$TAGS" --category 人工智能
chrome-use site csdn/article-publish         --title "$T" --markdown @post.md --summary "$S" --tags "$TAGS"
chrome-use site segmentfault/article-publish --title "$T" --markdown @post.md --tags "$TAGS"
chrome-use site zhihu/article-publish        --title "$T" --markdown @post.md --tags "Claude,AI编程,开源"
# add --draft true to any of them to stop after the draft
```

Common args: `title`, `markdown` (the whole body; adapter args are inline
strings, so pass a file with `--markdown @post.md`, or `@-` for stdin; chrome-use before 1.5.149 needs `"$(cat post.md)"`), `summary`, `tags`
(comma-separated), `draft`. Every adapter returns
`{ok, id, url, status, tags, skipped_tags}` or `{error, hint}`.

| adapter | extra args | how it posts |
| --- | --- | --- |
| `juejin/article-publish` | `--category` (name or id; required to publish) | `api.juejin.cn` `content_api/v1/article_draft/create` (`mark_content`, `edit_type` 10) then `article/publish {draft_id}`. Tag and category names are resolved through `tag_api/v1/query_tag_list` / `query_category_list`; max 3 tags. `brief_content` must be 50-100 characters to publish; without `--summary` it is cut from the body. |
| `csdn/article-publish` | `--category` (your 分类专栏), `--html`, `--id` (overwrite an existing article, e.g. an editor autosave) | `bizapi.csdn.net/blog-console-api/v3/mdeditor/saveArticle` as 原创, public, status 0 (publish) or 2 (draft), with `markdowncontent` plus HTML rendered by the adapter. The x-ca-* signatures come from the editor's own request client: the adapter borrows it from `editor.csdn.net/md/`, in a hidden same-origin frame when the tab is elsewhere. Accounts below blog level 3 cannot create tags; unknown tags are skipped. |
| `segmentfault/article-publish` | `--type` 原创/转载/翻译, `--source_url` | The page's own Api object (token header, signed GETs): `POST /gateway/draft`, then `POST /gateway/article` with the draft id. New accounts' articles go to manual review (up to four hours): `status` is then `in_review` and `message` says so. A `scene_id` (captcha) stops the run with the draft kept. |
| `zhihu/article-publish` | `--html` | `zhuanlan.zhihu.com/api/articles/drafts` (+ `PATCH …/draft`), topics bound via `…/topics` (max 3, from `autocomplete/topics`), then `www.zhihu.com/api/v4/content/publish` with `action: "article"`. Requests go through Zhihu's own fetch wrapper (xsrf + x-zse headers). Markdown is converted to Zhihu's HTML (h2/h3, `<pre lang>`). |

Tags are matched by exact name (then case-insensitively) against what the
platform already has, never by nearest neighbour, so a typo is reported in
`skipped_tags` instead of tagging the article with something unrelated.
Publishing needs at least one tag that exists.

**Risk.** One run = one article. If a publish step fails after the draft was
saved, the adapter returns the draft id and says so; do not re-run (you would
get a second draft), finish it in the site's editor. Check your article list
before re-posting something. Captchas, SMS or real-name checks are reported and
never worked around. Test with `--draft true` and delete the draft afterwards.

### `douyin-creator/video-publish` — publish a video on Douyin's creator center

One command with chrome-use 1.5.149 or newer: `--video` takes the local file,
the adapter opens the upload page, hands the file over, and once Douyin has
moved to the post page fills it in and clicks 发布 (or 暂存离开). `--until-done`
reruns it across that page change and while the file is still uploading.

```sh
chrome-use site douyin-creator/video-publish --video ./video.mp4 --until-done \
  --title "让 Claude Code 和 Codex 互相叫醒" \
  --description @desc.txt \
  --topics "AI编程,ClaudeCode,程序员" \
  --declaration ai --visibility public      # add --draft true to save a draft instead
```

With an older chrome-use, upload first and run the adapter without `--video`
(re-run while it says `incomplete` / `uploading`):

```sh
chrome-use open https://creator.douyin.com/creator-micro/content/upload
chrome-use upload 'input[type=file]' ./video.mp4     # the page moves on to /content/post/video by itself
chrome-use site douyin-creator/video-publish --title "…" --description "$(cat desc.txt)" --topics "…"
```

| arg | values |
| --- | --- |
| `--video` | local video file (chrome-use 1.5.149+). Skipped when the tab is already on the post page with a video uploaded |
| `--title` | required, at most 30 characters (作品标题) |
| `--description` | at most 1000 characters; newlines become new lines |
| `--topics` | comma-separated, `#` optional. Each is typed as `#name` and picked from Douyin's suggestion list by exact name (then case-insensitively). A name Douyin has no topic for (the list only offers to create it, heat 0) is taken back out and reported in `skipped_topics` |
| `--declaration` | 自主声明: `ai` 内容由AI生成, `opinion` 内容为个人观点或见解, `repost` 内容为转载信息 (declared 取材站外), `promo` 内容含营销推广信息, `fiction` 虚构演绎，仅供娱乐, `none` 无需添加自主声明. Omit to leave it unset |
| `--visibility` | `public` (default) 公开, `friends` 好友可见, `private` 仅自己可见 |
| `--draft` | `true` clicks 暂存离开 instead of 发布 |
| `--video_url` | upload page only, instead of `chrome-use upload`: fetch an https URL in the page and hand it to the file input. Needs a host that sends CORS headers and a file that downloads in a few seconds. **GitHub release assets do not work**: neither the `github.com/…/releases/download/…` redirect nor `release-assets.githubusercontent.com` sends `Access-Control-Allow-Origin` (checked 2026-09-30). Run again without it once the page is on the post page |

Returns `{ok, status, title, topics, skipped_topics, declaration, visibility, warnings, url, note}`
or `{error, hint}`. `status` is `published` (the page moved to the content manager;
the work shows 审核中 until review passes) or `draft`. `warnings` carries the 发文助手
quick-check findings (for example 横/竖双封面缺失, 作品原创性不足); they never block.

How it works, and why:

- **It drives the page's own form**, never Douyin's signed APIs: the title through
  the input's value setter plus an `input` event, the description through
  `execCommand('insertText')` and a synthetic Enter in the contenteditable
  `.editor-kit-container`, topics by clicking the suggestion item, 自主声明 in
  its dialog, 谁可以看 by its radio labels.
- **Upload finished** is read from the uploader component's React state
  (`uploadStatus` 1 uploading, 2 done, -1 failed). "上传成功" is only a toast
  and gone after a second, so it is no marker. While the upload runs the adapter
  returns `status: "uploading"` with `upload_percent` and touches nothing; run it
  again later.
- **The editor syncs its caret on `selectionchange`, which is asynchronous.**
  Typing right after moving the caret by script inserts at the editor's stale
  position: live, `#AI编程` came out as a copy of the first five characters and
  the second line vanished. The adapter puts the caret inside the last text leaf
  and yields before every edit.
- **chrome-use gives an adapter about 8 s.** The adapter works to a 7 s budget.
  If it runs out (many topics, a slow suggestion list) it stops before the next
  step with `status: "incomplete"`; every step checks what is already there, so
  running the same command again continues without doubling text or topics.
- If the page had not moved on after the click by the deadline, `status` is
  `publish_clicked` / `draft_clicked`. Check the content manager (or the
  upload page) before running again: a re-run could post twice.
- **Drafts.** Douyin keeps one unfinished video. After 暂存离开 the upload page
  shows 你还有上次未发布的视频，是否继续编辑？ with 继续编辑 (resume) and 放弃
  (discard).
- A captcha, slider or SMS check stops the run with an error. It is never worked
  around.

**Risk.** This posts to your real account, and Douyin (like Xiaohongshu) acts
on scripted behaviour. One run = one video. Test with `--draft true --visibility
private`, then discard the draft with 放弃. The adapter's tests run against the
post page captured in `douyin-creator/fixtures/` (`node --test`); the one live
check was a private draft of a 3 s test clip, discarded afterwards.

### `youtube-studio/video-upload` — upload and publish a video in YouTube Studio

One command with chrome-use 1.5.149 or newer: `--video` takes the local file,
the adapter opens the channel's upload dialog (the tab must be on a
`studio.youtube.com/channel/UC…` page), hands the file over, fills the dialog
and publishes. `--until-done` reruns it while Studio says uploading /
processing / checking; the adapter's own default is 30 minutes, raise it with
`--timeout 60m`, or pass `--wait_checks false` to publish once the upload is
complete.

```sh
chrome-use open https://studio.youtube.com
chrome-use site youtube-studio/video-upload --video ./video.mp4 --until-done \
  --title "让 Claude Code 和 Codex 互相叫醒" --description @desc.txt \
  --visibility private --made_for_kids false --ai_altered no \
  --category 科学和技术 --tags "Claude Code,Codex" --language zh-Hans
```

With an older chrome-use, upload first and run the adapter without `--video`,
re-running while it says uploading / processing / checking:

```sh
chrome-use open 'https://studio.youtube.com/channel/<channel id>/videos/upload?d=ud'
chrome-use upload 'input[type=file]' ./video.mp4      # the dialog opens on 详细信息 / Details by itself
chrome-use site youtube-studio/video-upload --title "…" --description "$(cat desc.txt)" --visibility private

# later, on the video's edit page, change only the visibility
chrome-use open https://studio.youtube.com/video/<video id>/edit
chrome-use site youtube-studio/video-upload --visibility public
```

| arg | values |
| --- | --- |
| `--title` | at most 100 characters, no `<` `>`. Omit to keep Studio's (the file name) |
| `--description` | at most 5000 characters, no `<` `>`; newlines are kept |
| `--visibility` | `private` (default), `unlisted`, `public` |
| `--made_for_kids` | `false` (default) or `true`. Studio will not go past Details without it |
| `--ai_altered` | `yes` / `no`: the altered or synthetic content question (realistic people, events, places). Omit to leave it unanswered |
| `--category` | display name as Studio shows it (科学和技术) or the id suffix (`SCIENCE`, `EDUCATION`, …) |
| `--tags` | comma-separated. Missing tags are added; tags already on the video are kept |
| `--playlist` | name of an existing playlist to tick; an unknown name is a warning |
| `--language` | video language as a code (`zh-Hans`, `en`) or its name in the menu |
| `--allow_embed` | `true` (default) / `false` |
| `--wait_checks` | `true` (default) publishes only after the upload, processing and copyright checks finish. `false` publishes once the upload is done |

Returns `{ok, status, url, visibility, title, warnings, done}` or `{error, hint}`.
`status` is `saved` (private) or `published` once the dialog closed, `uploading` /
`processing` / `checking` (details are filled, nothing published yet, with `percent`
and Studio's `progress` text), `incomplete` (out of time, re-run), or on the edit page
`visibility_changed` / `unchanged`. `url` is `https://youtu.be/<id>` from the dialog's
`video-id`. `warnings` carries the checks result when it is not 未发现任何问题 (e.g. a
copyright claim) and notices such as 如需提供可点击的外部链接，请先完成一次性验证 (the
channel is not phone-verified; the adapter reports it and never verifies).

How it works:

- **Studio's own dialog, real DOM events only.** Studio is Polymer on shady DOM,
  so `document.querySelector` reaches everything and a DOM `click()` is what its
  tap handlers take (a pointer click at the element's centre is often occluded by
  a banner). Stable hooks: `ytcp-uploads-dialog[workflow-step][video-id]`,
  `#title-textarea` / `#description-textarea` `#textbox`, radio `name`s
  (`VIDEO_MADE_FOR_KIDS_NOT_MFK`, `VIDEO_HAS_ALTERED_CONTENT_NO`, `PRIVATE` / `UNLISTED` /
  `PUBLIC`), menu items' `test-id` (`CREATOR_VIDEO_CATEGORY_SCIENCE`, `zh-Hans`).
- **Title and description** go in with one `execCommand('insertText')` over a
  `selectAll`: typing keys into the description dropped part of a long
  multi-line text.
- **Progress** is read from `ytcp-video-upload-progress` (`uploading` attribute,
  `checks-summary-status-v2`, `.progress-label`).
- **Steps restamp.** Moving between 详细信息 → 视频元素 → 检查 → 公开范围 rebuilds each
  step's DOM (and folds 显示高级设置 up again); Studio keeps the values. A run that
  verified the details for these arguments marks the dialog, so later runs go
  straight on; a run that finds the dialog on a later step without that mark goes
  back to 详细信息 and checks every field first.
- **7 s budget** inside chrome-use's ~8 s window; every step checks before it acts,
  so re-running continues without doubling text or tags.
- A captcha or identity check stops the run with an error.

**Risk.** This publishes to your real channel. Upload with `--visibility private`,
check the video, then switch it on the edit page. Tests run against the dialog
captured in `youtube-studio/fixtures/` (`node --test`).

### `bilibili-creator/video-publish` — publish a video on Bilibili (投稿)

One command with chrome-use 1.5.149 or newer: `--video` takes the local file,
the adapter opens the 投稿 page, hands the file over, fills the form, and
`--until-done` reruns it until 上传完成 and 立即投稿 is clicked.

```sh
# check the filled form first (optional): --submit false stops before 立即投稿
chrome-use site bilibili-creator/video-publish --video ./video.mp4 --until-done \
  --title "让 Claude Code 和 Codex 互相叫醒" --description @desc.txt \
  --tags "Claude Code,Codex,AI编程,开源" --category 科技数码 \
  --type self --declaration ai --submit false
chrome-use site bilibili-creator/video-publish …same arguments without --video and --submit false, with --until-done
```

With an older chrome-use, upload first and run the adapter without `--video`,
re-running while it says `incomplete` / `uploading`:

```sh
chrome-use open https://member.bilibili.com/platform/upload/video/frame
chrome-use upload '.bcc-upload-wrapper input[type=file]' ./video.mp4     # the form opens below the file list
chrome-use site bilibili-creator/video-publish --title "…" --description "$(cat desc.txt)" --tags "…"
```

| arg | values |
| --- | --- |
| `--title` | at most 80 characters |
| `--description` | 简介, at most 2000 characters; newlines become paragraphs |
| `--tags` | comma-separated, 1–10, each ≤ 20 characters. A tag found in 推荐标签 is clicked there, the rest are typed and entered. Tags already on the form that are not listed are removed (Bilibili pre-fills some) |
| `--category` | 分区 as the menu shows it. The menu is flat now (科技数码, 人工智能, 知识 …; 计算机技术 / 软件应用 are no longer entries); a path like `科技 → 计算机技术` is matched segment by segment and lands on 科技数码, with a warning. Omit to keep Bilibili's pick |
| `--type` | `self` (default): ticks 内容为自制：未经作者允许，禁止转载 (copyright 自制). `repost`: picks 内容为转载 and fills 转载来源 from `--source` |
| `--declaration` | 创作声明: `ai` 含AI生成内容, `fiction`, `promo`, `opinion`, `none` 内容无需标注 (used when the field is empty). It is one menu with 内容为转载, so it cannot be combined with `--type repost` |
| `--visibility` | `public` (default, 公开可见) / `private` (仅自己可见) |
| `--draft` | `true` clicks 存草稿 instead of 立即投稿 |
| `--submit` | `false` fills everything and clicks nothing, to look at the form first |

Returns `{ok, status, bvid, url, tags, skipped_tags, removed_tags, statement, self_made,
category, visibility, cover, warnings}` or `{error, hint}`. `status` is `submitted`
(with `bvid` and `https://www.bilibili.com/video/<bvid>`), `draft`, `filled`,
`uploading` (form filled, file not done yet), `incomplete` (out of time, re-run),
`dialog` (Bilibili opened a confirmation after the click; it is reported, never
answered), `already_submitted` (the tab shows a finished submit), or
`submit_clicked` (no confirmation seen: check 稿件管理 before re-running).

How it works:

- **Real DOM events only**, on the page's own widgets; no Bilibili API calls (its web
  APIs need wbi signing). The Vue component state is only *read*: whether the 自制 box
  is ticked, and `completeBvid` after the submit.
- **Tags** are checked by Bilibili when entered. A refusal comes back as a
  `toaster-v2-wrp` toast and lands in `skipped_tags` with its text, e.g. 程序员:
  当前tag为话题专用，不允许自定义添加 (topic-only tags are joined via 参与话题, which this
  adapter does not do).
- **简介** is a Quill editor: `execCommand('insertText')` per line and an Enter key
  per paragraph, then the text is read back and compared.
- **Cover**: Bilibili's is kept. If the slot is still empty, the first recommended
  frame is clicked.
- **7 s budget** inside chrome-use's ~8 s window; each step checks before it acts, so a
  re-run continues without doubling tags or text. Typed tags take about half a
  second each, so a first run with many tags usually stops with `incomplete` once.
- A shown captcha / geetest / 安全验证 stops the run with an error.

**Risk.** This publishes to your real account, and Bilibili is treated like
Xiaohongshu: one live run, never a loop (see AGENTS.md). Tests run against the form
captured in `bilibili-creator/fixtures/` (`node --test`). The live check was one
real publish (BV1fqad6TET7), filled once with `--submit false`, then submitted.

### `si12333/pension-payments` — China pension contribution history (国家社会保险公共服务平台)

Read-only. Lists every month of 企业职工基本养老保险 contributions on [si.12333.gov.cn](https://si.12333.gov.cn), across every 参保地 (provincial pool) and year, in one command.

```sh
chrome-use site si12333/pension-payments                 # 1995 to this year, every pool
chrome-use site si12333/pension-payments --from 2015 --to 2023 --region 北京
```

Sign in first: the site only accepts a scan with the 掌上12333 app or the e-social-security card, so a person has to do it (`chrome-use session handoff`). The session expires after a while; the adapter then returns `{"error": "not logged in"}`.

The site encrypts both request and response bodies, so the adapter drives the page's own query form instead of calling the API. Each query covers at most 3 years and asks which pool to show, so the adapter walks every pool × 3-year window. It returns:

- `rows`: `{pool, period, place, employer, personal, base_est}` per month. `personal` is the employee's share, normally 8% of the contribution base, so `base_est = personal / 0.08` (flexible-employment months are paid differently, so `base_est` does not apply to them).
- `summary` per pool (months, first/last period, personal total), `distinct_months`, and `overlapping_months` (months paid in two pools at once; only one counts when the pools are merged).

### `appstoreconnect/` — App Store Connect apps and builds

Runs in your signed-in [appstoreconnect.apple.com](https://appstoreconnect.apple.com) tab and calls the same `/iris/v1` JSON:API the web UI uses. Creating an app record is the one step the App Store Connect API key cannot do (it returns 403); a signed-in session can.

```sh
chrome-use site appstoreconnect/apps                                  # every app: name, bundle id, SKU, Apple ID
chrome-use site appstoreconnect/app-create --name "My App" --bundle_id com.example.app --sku example-app --locale zh-Hans
chrome-use site appstoreconnect/builds --bundle_id com.example.app    # newest uploads and their processing state
```

- `app-create` needs the bundle id registered in the developer portal first (the API key can do that). It is idempotent: if an app with that bundle id exists, it returns it with `created: false` instead of making a second one. On failure, `reasons` carries Apple's own messages, such as a name already taken.
- Sign in first, including two-factor authentication; a person has to do that (`chrome-use session handoff`). A signed-out session returns `hint: "Not signed in…"` instead of an empty list.
- Creating an app needs the Admin or App Manager role.

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

## License

MIT, see [LICENSE](LICENSE). Contributions are accepted under the same license.
