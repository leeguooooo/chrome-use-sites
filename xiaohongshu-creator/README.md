# `xiaohongshu-creator/` — your own Xiaohongshu creator center, read-only

English · [中文](README.zh.md)

Reads `creator.xiaohongshu.com` (创作服务平台) as the account signed in there: profile counts with the data center's 7/30-day summary, the note manager list, and per-note analytics. Every adapter is read-only. You must be signed in to `creator.xiaohongshu.com` in the browser chrome-use drives; it is a separate login (its own QR code) from `www.xiaohongshu.com`. For the public site, see [`xiaohongshu/`](../xiaohongshu/README.md).

## Commands

```sh
chrome-use site xiaohongshu-creator/me
chrome-use site xiaohongshu-creator/me --summary false            # profile only, one request
chrome-use site xiaohongshu-creator/notes --limit 10 --tab published
chrome-use site xiaohongshu-creator/notes --page 2                # next_page from the last call
chrome-use site xiaohongshu-creator/note-stats 6abbe0ef000000001203e9c7
chrome-use site xiaohongshu-creator/note-stats "https://www.xiaohongshu.com/explore/6abbe0ef000000001203e9c7"
```

## Adapters

| adapter | args | returns / does |
| --- | --- | --- |
| `xiaohongshu-creator/me` | `[--summary false]` | `user_id`, `nickname`, `red_id`, `avatar`, `desc`, `fans`, `follows`, `likes_and_collects` (XHS only publishes the combined 获赞与收藏), `level`, `profile_url`, and `data_center` with `last_7_days` / `last_30_days`: `start`, `end`, `impressions`, `views`, `cover_click_rate_pct`, `avg_view_time_sec`, `home_views`, `likes`, `collects`, `comments`, `shares`, `new_fans`, `lost_fans`, `net_new_fans`, `notes_published`. Calls `GET /api/galaxy/creator/home/personal_info` and `/api/galaxy/v2/creator/datacenter/account/base` together, as the home page does; `--summary false` skips the second (`data_center: null`). If only the summary fails, `data_center` is `{error, hint}` and the profile half is still returned. The user id comes from the page's Vuex store, not a request. |
| `xiaohongshu-creator/notes` | `[--limit N] [--page N] [--tab T]` | The note manager's `GET /api/galaxy/v2/creator/note/user/posted?tab=&page=`. `limit` default 20, max 50; the server pages by 10, so it costs one request per 10 notes. `page` is the cursor (default 0). `tab`: `all` (default), `published`, `reviewing`, `rejected`, `scheduled`, or 全部/已发布/审核中/未通过/定时发布. Returns `tab`, `count`, `total` (the figure next to the tab), `page`, `next_page` (`null` at the end), `partial` (set when a later page failed or timed out), and `notes`. Each note: `id`, `title`, `type` (`normal`/`video`), `published_at` (+08:00), `status` / `status_text` / `status_code`, `visibility` / `visibility_text` / `visibility_code`, `pinned`, `scheduled_at`, `video_duration`, `cover`, `url` (with the `xsec_token` the manager hands out), `xsec_token`, `views`, `likes`, `collects`, `comments`, `shares`. |
| `xiaohongshu-creator/note-stats` | `<note_id> [--audience false]` | The 笔记数据 page's `GET /api/galaxy/creator/datacenter/note/base`, `…/note/audience/source` and `…/note/audience/source/detail`. `note_id` is a 24-hex id or a `www.xiaohongshu.com/explore/<id>` URL. Returns `note_id`, `type`, `desc`, `published_at`, `days_since_post`, `data_updated_at`, `cover`, `url`, `topics`, and `metrics`: `impressions`, `views`, `cover_click_rate_pct`, `avg_view_time_sec`, `likes`, `collects`, `comments`, `shares`, `follows_gained`, `danmaku`, `interaction_rate_pct`; image notes add `avg_images_viewed`, videos add `full_view_rate_pct`, `finish_5s_rate_pct`, `exit_2s_rate_pct`, `play_60s_count`. `traffic_sources` (`{available, reason, sources}`) and `audience` (`{available, reason, gender, age, city, interest}`) as `{name, pct}` lists; `--audience false` skips those two requests. Only works for notes this account published. |

Status codes, as the creator bundle defines them:

| `status_code` | `status` | shown as |
| --- | --- | --- |
| 1 | `published` | 已发布 |
| 2 | `reviewing` | 审核中 |
| 3 | `rejected` | 未通过 |
| 4 | `scheduled` | 定时发布 |

Visibility codes:

| `visibility_code` | `visibility` | shown as |
| --- | --- | --- |
| 0 | `public` | 公开可见 |
| 1 | `private` | 仅自己可见 |
| 2 | `partially_hidden` | 部分人不可见 |
| 3 | `partially_visible` | 部分人可见 |
| 4 | `friends_only` | 仅互关好友可见 |

**How it calls the API.** Every creator API request carries `X-s` / `X-t` / `X-S-Common` signature headers, computed by the page's own HTTP client (which calls `window._webmsxyw`). The adapters find that client in the page's webpack registry, through a module that calls it with a known endpoint key, and call it. Each request is built, signed and sent exactly as the creator center sends it. Nothing here fetches directly or reimplements the signature, and a test fails if an adapter tries.

**Gotchas**

- **Missing metrics are `null`, never 0.** The data center reports "not computed yet" as `-1`; a note under a day old reads `-1` for impressions, view time and most rates. Image notes report `0` for the video-only rates, which means "n/a", so those are `null` too.
- **Audience and traffic breakdowns need an audience.** Below the threshold (the page says 50 viewers in one place, 100 in another) they come back as `available: false` with a `reason`, e.g. `"观看数不足100，暂时无法分析"`.
- **The `notes` cursor is a page number, not an offset.** If `limit` cuts a page short, `next_page` points back at that page, so resuming repeats a few notes rather than skipping them. Dedupe by `id`.
- **chrome-use gives an adapter about 8 s.** Each adapter works to a 7 s budget: a slow call comes back as `"did not answer … in time"`, and `notes` returns the pages it already has with `partial` set and a cursor to resume from. Retry once, not in a loop.
- `tab_status` on a note and the `tab` query parameter number their states differently ("all" is tab 0 and has no status). Don't feed one into the other.
- The manager's `time` is China-local `YYYY-MM-DD HH:mm`; `published_at` adds `+08:00`. `note-stats` uses the epoch `postTime`, so it has seconds too.

## Safety / testing

- These run as you, against your real account. They are read-only (the page client's `post` is never called) and cheap: `me` is 2 requests, `notes` 1 per 10 notes, `note-stats` 3, the same calls the pages make when you open them.
- Xiaohongshu bans accounts for scripted behaviour. Don't loop, poll, or page through every note on a timer.
- A live check is **one run per adapter, one page, never a loop**. Develop against `xiaohongshu-creator/fixtures/` and the stubbed tests instead.
- HTTP 461 or 429 means XHS wants a captcha or is throttling you: stop, and open the creator center by hand. A 401 / code -101 means the session is gone; log in again.

## Tests

`node --test xiaohongshu-creator/`

See [CHANGELOG](../CHANGELOG.md) for changes.
