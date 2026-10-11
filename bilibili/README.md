# `bilibili/` — a user's uploads and your videos' creator-center numbers

English · [中文](README.zh.md)

Two read-only adapters for Bilibili. `user-videos` lists anyone's uploads (投稿) from `api.bilibili.com`, run from a `www.bilibili.com` tab. `creator-stats` reads the creator center's (创作中心) numbers for one of the signed-in account's own videos, run from a `member.bilibili.com` tab. Sign in to bilibili.com in the browser chrome-use drives first.

The rest of `bilibili/*` (`me`, `search`, `feed`, `video`, …) comes from the community pack ([epiral/bb-sites](https://github.com/epiral/bb-sites)); these two are maintained here, and chrome-use runs these files instead of OpenCLI's commands of the same name. Publishing lives in [`bilibili-creator/`](../bilibili-creator/).

## Commands

```sh
chrome-use site bilibili/user-videos 53579383                 # newest 20
chrome-use site bilibili/user-videos 53579383 --limit 200     # pages through, 50 a page
chrome-use site bilibili/user-videos https://space.bilibili.com/53579383 --order click
chrome-use site bilibili/creator-stats BV1xx411c7mD
chrome-use site bilibili/creator-stats https://www.bilibili.com/video/BV1xx411c7mD
```

## Adapters

| adapter | args | returns / does |
| --- | --- | --- |
| `bilibili/user-videos` | `<uid>` (UID, `space.bilibili.com/<uid>` URL, or exact 昵称) `[--limit N] [--order pubdate\|click\|stow] [--page N]` | The WBI-signed `/x/space/wbi/arc/search`. `limit` defaults to 20, at most 1000; past 50 it pages. Returns `{ mid, order, total, count, videos }`, each video `rank, bvid, aid, title, plays, likes, comments, danmaku, length, created, date, url`. Read-only. |
| `bilibili/creator-stats` | `<bvid>` (exact BV id or `https://www.bilibili.com/video/BV…` URL) | The creator center's `archive_diagnose/compare` list (the account's latest 100 videos). Returns `{ ok, bvid, title, source, values, metrics, missing }`. Read-only. |

### `bilibili/user-videos` details

- **Signing in the page.** The WBI signature (`w_rid`, an MD5 over the sorted query and the mixin key from `/x/web-interface/nav`) is computed in the tab; it also sends the `dm_img_*` fields the space page sends.
- **Risk control.** On `-352` (风控) it fetches fresh keys, waits 1.5 s and tries once more. If that fails too it returns the error with a hint, plus any pages already read (`partial: true`). It never loops.
- **Names.** A 昵称 resolves only on an exact match among Bilibili's user search results. Otherwise it returns `candidates` (`mid, uname, fans`) and reads nothing, rather than reading the wrong account.
- `likes` is `null` when Bilibili leaves it out of the list (it often does): a missing count is `null`, never 0. `created` is ISO 8601; `date` is `YYYY-MM-DD`.

### `bilibili/creator-stats` details

- `metrics` is a list of `{ metric, value, unit }`; `values` is the same as one object. The metrics: `playCount, likeCount, commentCount, danmakuCount, favoriteCount, coinCount, shareCount, newFollowerCount` (count), `durationSeconds` (seconds), and `completionPct, activeFollowerViewPct, thumbnailClickPct, threeSecondExitPct, interactionPct, playToFollowerPct` (percent; Bilibili sends basis points, the adapter divides by 100).
- A metric Bilibili leaves out is `null` and named in `missing`; a malformed row for another video is skipped. Neither fails the command.
- `source: "creator_center"` normally. A video outside the latest 100 falls back to its public counts from `/x/web-interface/view` (`source: "public"`, with `owner` and a `note`): the counts are filled, the follower and rate metrics are `null`.
- Errors: `not_logged_in`, `no_stats_yet` (Bilibili has not analysed the video yet), `not_found`, and bad input, which is rejected before any request.

## Origin and license

Both are ported from [OpenCLI](https://github.com/jackwener/opencli) v1.8.8 (`clis/bilibili/user-videos.js`, `clis/bilibili/creator-stats.js`, and helpers from `clis/bilibili/utils.js`), Copyright 2025 jackwener, under the Apache License 2.0 ([LICENSE-OpenCLI](LICENSE-OpenCLI)). Each file's header says what chrome-use changed.

## Safety / testing

They only read, but they read a real signed-in account, and Bilibili rate-limits scripted reads: develop against the stubs, and a live check is one run, never a loop (AGENTS.md).

## Tests

`node --test bilibili/`

See [CHANGELOG](../CHANGELOG.md) for changes.
