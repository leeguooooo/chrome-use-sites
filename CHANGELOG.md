# Changelog

Every change to an adapter, its docs or the installer goes here, newest first.
This repo has no version numbers: chrome-use syncs `main`, so entries are dated
by the day they reached `main`. Each pack's own README lists its adapters; this
file says what changed and when.

## 2026-10-26

### Changed
- `bilibili-creator/video-publish`: stop for explicit cover review; return existing
  recommendation candidates and require `--cover-index` before AI-recommendation
  selection. `--cover-mode keep` requires an existing cover.
- `douyin-creator/video-publish`: stop public publishing until landscape 4:3 and
  portrait 3:4 covers have been reviewed and explicitly accepted; drafts remain available.
- `youtube-studio/video-upload`: require thumbnail approval before public/unlisted
  publishing; support `--cover` image upload with a verified visible custom preview.
  Unconfirmed upload/crop state stops submission. Private saves remain available.
- Cover generation, arbitrary frame extraction, updates of existing works and
  unsupported platform packs remain unimplemented; adapters do not claim success for them.

## 2026-10-23

### Fixed
- `douyin-creator/video-publish`: a topic typed partly through an IME (such as
  `AI编程`) was skipped when Douyin's suggestion list for the shorter query
  (`#AI`) was still up; it now waits for the exact topic first.

### Changed (stealth)
- `douyin-creator/video-publish`, `twitter/post`: with chrome-use 1.5.260+
  the file input is handed to `setOn` as an element, so Douyin's video input
  is no longer marked `data-cu-file` and `twitter/post` adds no
  `#cu-twitter-post-media` input to x.com (it sets the file on a detached
  one). Older chrome-use keeps the old way.
- `douyin-creator/video-publish`, `douyin/delete`, `bilibili-creator/video-publish`,
  `youtube-studio/video-upload`, `twitter/delete`, `twitter/like`,
  `twitter/follow`: declare `"world": "isolated"`, so chrome-use 1.5.259+ runs
  them in the tab's isolated world, where the page sees none of their DOM
  reads. Page-only state goes through `args.page`: Douyin's React uploader
  state and its signed `/janus` work_list fetch, Bilibili's Vue store fields
  (as a snapshot refreshed when needed). YouTube's `__cu*` markers on page
  elements are no longer visible to the page. Older chrome-use runs them in the
  page as before.
- `stealth.test.js`: a write adapter that uses `args.ui` must declare
  `"world": "isolated"` (chatgpt/open-project excepted until it can be checked
  live).

## 2026-10-22

### Changed (stealth)
- `xiaohongshu-creator/*` (shared helper): no longer keeps the page's HTTP
  client on `window.__chromeUseXhscClient`, and takes the chunk it pushes to
  find webpack's require back out of the page's chunk list, with a nameless
  id instead of `Symbol('chrome-use-xhsc')`.
- `si12333/pension-payments`: counts the page's payment queries with a
  `PerformanceObserver` instead of patching `XMLHttpRequest.prototype` and
  keeping `window.__si12333Hook`.
- `chatgpt/open-project`: clicks the sidebar link through `args.ui` with
  chrome-use 1.5.253+.
- New `stealth.test.js`: a write adapter that clicks or types must use
  `args.ui`, and no adapter may set a named global on `window`
  (CONTRIBUTING.md rule 6).

### Changed
- `douyin-creator/video-publish`, `douyin/delete`, `bilibili-creator/video-publish`,
  `youtube-studio/video-upload`, `twitter/delete`, `twitter/like`,
  `twitter/follow`: with chrome-use 1.5.253+ their clicks, typing, key presses
  and list scrolling go through `args.ui`, which the daemon serves with real
  pointer and key events (`isTrusted`) at a human pace, instead of the
  adapter's own `el.click()`, `dispatchEvent` and `execCommand`, which a site
  can tell apart from a person. Fixed pacing waits are jittered. A ui call that
  fails (element covered, gone) falls back to the old events, and the result
  lists it in `ui_fallbacks`; older chrome-use keeps the old events throughout.
  YouTube text too long to type in the time left is inserted as before.

## 2026-10-12

### Fixed
- `hackernews/top`, `hackernews/thread`: added here, replacing the community
  pack's versions (epiral/bb-sites), which chrome-use now stops running. Those
  fetch `hacker-news.firebaseio.com` from the `news.ycombinator.com` tab, but
  HN's CSP (`default-src 'self'`, no `connect-src`) blocks that, so they always
  failed with `TypeError: Failed to fetch`. These read HN's same-origin HTML
  instead (`/news` and `/news?p=2` for `top`, `/item?id=` for `thread`) and
  return the same fields and result envelope.

## 2026-10-11

### Added
- `bilibili/user-videos`, `bilibili/creator-stats`, `twitter/like`,
  `twitter/follow`: the rest of what the account-upkeep routine ran through
  OpenCLI, ported from OpenCLI v1.8.8 (Apache-2.0, credited in each file and in
  `bilibili/LICENSE-OpenCLI` / `twitter/LICENSE-OpenCLI`); chrome-use always
  runs these files instead. `bilibili/user-videos` signs WBI in the page,
  retries risk control (-352) once with fresh keys, pages past 50 videos,
  resolves a 昵称 only on an exact match, and returns `null` (not 0) for counts
  Bilibili leaves out. `bilibili/creator-stats` no longer fails on one missing
  metric or one malformed row, and falls back to a video's public counts when it
  is not among the account's latest 100. `twitter/like` and `twitter/follow`
  never undo an existing like or follow, and wait for the button to change to
  confirm; `twitter/follow` clicks only the profile's own button, never a
  "Who to follow" suggestion (OpenCLI took the first one on the page). Run the
  twitter two with `--until-done`: they open the tweet or profile first.
- `douyin/delete`, `douyin/update`: delete a work from 作品管理, or change a
  scheduled work's publish time and its text. Ported from OpenCLI v1.8.8
  (Apache-2.0, credited in each file and in `douyin/LICENSE-OpenCLI`) so
  chrome-use stops running OpenCLI for them; chrome-use always runs these
  files instead. They keep chrome-use's fixes to OpenCLI's `douyin/delete`
  (chrome-use#508, #525): 64-bit ids stay exact strings (`item_id` arrives as a
  bare JSON number past 2^53), and the work card is found by its title, with
  scrolling, instead of by position. `douyin/delete` also pages `work_list`
  to find older works. Run `douyin/delete` with `--until-done`: it opens 作品管理
  first.
- `twitter/delete`: delete one of the signed-in account's tweets through the
  tweet's ⋯ menu. Ported from OpenCLI v1.8.8 (Apache-2.0,
  `twitter/LICENSE-OpenCLI`); also takes a bare tweet id. Run with
  `--until-done`: it opens the tweet first.

## 2026-10-09

### Added
- `twitter/user`: profile counts (followers, following, posts, media, likes), bio,
  location, website, pinned posts. Reads X's 2026 `UserByScreenName` shape, where
  the counts moved to `relationship_counts` / `tweet_counts` / `action_counts`,
  and the older `legacy` shape. Without a handle it reads the signed-in account.
  Overrides the community `twitter/user`, which returned no counts. (#16)
- `douyin-creator/me`, `douyin-creator/works`: the signed-in Douyin account and
  every work with plays, likes, comments, shares, collects and public/private.
  A dropped page is retried once, then the works so far come back with
  `next_cursor`. (#16)
- `xiaohongshu/me`: profile counts, IP 属地 and the newest notes from
  `www.xiaohongshu.com` in one request, without the creator-center login.
  Overrides the community `xiaohongshu/me` and keeps its field names. (#16)
- `youtube-studio/channel`: subscribers, video count, total views and uploads
  (Shorts included) through Studio's own API. (#16)
- Every pack directory has a `README.md` and a `README.zh.md`, written against
  the adapter code (the old root sections had missed args, fields and statuses).
  The root README is now an index of packs, with a Chinese version.
- `CONTRIBUTING.md` / `CONTRIBUTING.zh.md`, a pull request checklist, and a CI
  workflow that runs `node --test` on every PR. `docs.test.js` fails when a pack
  lacks either README, a README misses one of its adapters, or an adapter never
  appears in this changelog.

## 2026-10-07

### Added
- `chatgpt/images`: a conversation's generated images with fresh download URLs.
- MIT license. (#15)

## 2026-10-06

### Added
- `twitter/post`: posts through X's own `CreateTweet`, checks X's 280-character
  weighting first (CJK counts 2, links 23), `--dry_run`, `--reply_to`. (#13)
- `twitter/post --media`: uploads a local video or image (chunked, waits for
  processing) before tweeting; a failed upload posts nothing. (#14)

## 2026-10-03

### Fixed
- `appstoreconnect/app-create` sends the version localization with the web UI's
  local ids. (#12)

## 2026-10-02

### Added
- `appstoreconnect/apps`, `appstoreconnect/app-create`, `appstoreconnect/builds` over the signed-in App Store
  Connect session.
- `si12333/pension-payments`: every month of China pension contributions from
  国家社会保险公共服务平台.

## 2026-09-30

### Added
- `xiaohongshu-creator/me`, `xiaohongshu-creator/notes`, `xiaohongshu-creator/note-stats`: read-only creator-center
  adapters.
- `juejin/article-publish`, `csdn/article-publish`, `segmentfault/article-publish`,
  `zhihu/article-publish`: cross-post a
  Markdown article.
- `douyin-creator/video-publish`, `bilibili-creator/video-publish`,
  `youtube-studio/video-upload`: fill each platform's post form and publish.
- One-command video publishing with `--video` (needs chrome-use 1.5.149+).

## 2026-09-10

### Added
- `chatgpt/me`, `chatgpt/conversations`, `chatgpt/projects`, `chatgpt/models`,
  `chatgpt/conversation`: read-only,
  fetch-only adapters on the signed-in ChatGPT session. (#3, #5)
- `chatgpt/open-project`: enters a ChatGPT Project by name. (#7)
- A test that `install.sh` lists every adapter in a pack, and nothing removed.

### Fixed
- `install.sh` fetches the community `twitter/_helper.js` the twitter adapters
  call into, pinned to a commit. (#6)

### Docs
- Forbid testing the chatgpt adapters against the live ChatGPT (AGENTS.md).

## 2026-07-28

### Added
- `twitter/search`, `twitter/thread` with a stable engagement schema (likes,
  retweets, replies, bookmarks, numeric views; `null` when X hides one). (#2)

## 2026-07-24

### Docs
- Marked this repo as chrome-use's official default adapter source. (#1)

## 2026-07-21

### Added
- `sggit/pr-create`, `sggit/pr-list`, `sggit/pr-merge` for the self-hosted Gogs
  at `sg-git-src.pwtk.cc`, and `install.sh`.
