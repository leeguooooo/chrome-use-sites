# `douyin/` — delete or change your own Douyin works

English · [中文](README.zh.md)

Two write adapters for `creator.douyin.com`, run in your logged-in creator-center tab. They keep the names `douyin/delete` and `douyin/update` from [OpenCLI](https://github.com/jackwener/opencli), which chrome-use used to run for these commands; this pack is now where they are maintained, and chrome-use always runs these files instead of OpenCLI's. To list works and read their ids, use [`douyin-creator/works`](../douyin-creator/).

## Commands

```sh
chrome-use site douyin-creator/works --limit 20          # find the id
chrome-use site douyin/delete 7694857245896576275 --until-done
chrome-use site douyin/update 7694857245896576275 --caption @caption.txt
chrome-use site douyin/update 7694857245896576275 --reschedule 2026-10-20T20:00:00+08:00
```

## Adapters

| adapter | args | returns / does |
| --- | --- | --- |
| `douyin/delete` | `<aweme_id>` | **Deletes.** On 作品管理 (`/creator-micro/content/manage`) it finds the work in `work_list` (paging up to 10 pages), finds its card by title, clicks 删除作品, confirms, then checks `work_list` until the work is gone. Returns `{ ok, status: "deleted", aweme_id, item_id, title }`. Run it with `--until-done`: off 作品管理 the first run returns `status: "navigating"` and opens it, and the rerun deletes. |
| `douyin/update` | `<aweme_id> [--reschedule <time>] [--caption <text>]` | **Writes.** `--reschedule` moves a scheduled work's publish time (ISO 8601 or Unix seconds, 2 hours to 14 days from now) through `update/timer`; `--caption` replaces its text through `update/desc`. Returns `{ ok, status: "updated", aweme_id, updated, publish_time }`. |

### Details

- **Exact ids.** Douyin sends 64-bit ids such as `item_id` as bare JSON numbers, which `JSON.parse` rounds (`7694857245896576275` becomes `7694857245896576000`, the same as its neighbours). Both adapters parse responses so integers past 2^53 come back as exact strings, compare ids as strings, and send them as strings.
- **Card by title, not position.** `douyin/delete` clicks only a card showing the work's title (its `item_title`, or the first line of its text). Among several such cards it takes the one whose markup carries the id; a card list shorter than `work_list` is scrolled to load more. If no card matches it returns `card_not_found` and clicks nothing. (OpenCLI picked the card at the work's position in `work_list`, which failed or could pick the wrong card when the page rendered fewer cards; chrome-use#508.)
- **Errors** come back as `{ error, hint, aweme_id, item_id? }`: `not_found` (no such work in the account's work list: already deleted, or another account's), `card_not_found`, `delete_button_not_found`, `confirm_button_not_found`, `delete_not_confirmed` (confirm was clicked but the work is still listed), `work_list_*` (the list call failed). `douyin/update` says which of its two calls already ran (`updated`).

## Safety / testing

These adapters change a real account, so they are tested only against stubs: `node --test douyin/`. `fixtures/work_list_bigint.json` is `work_list`'s shape with synthetic ids, `item_id` as a bare 19-digit number. Don't check them live on works you want to keep (AGENTS.md).

## Origin and license

Ported from OpenCLI v1.8.8 (`clis/douyin/delete.js`, `clis/douyin/update.js`, `clis/douyin/_shared/timing.js`), Copyright 2025 jackwener, under the Apache License 2.0; the license text is in [LICENSE-OpenCLI](LICENSE-OpenCLI). Each file's header says what chrome-use changed. The rest of this repo is MIT.

See [CHANGELOG](../CHANGELOG.md) for changes.
