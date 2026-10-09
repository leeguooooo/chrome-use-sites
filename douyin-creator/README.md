# `douyin-creator/` — publish videos and read your own Douyin account

English · [中文](README.zh.md)

Works on Douyin's creator center, `creator.douyin.com`, as the account signed in there. `video-publish` uploads a video, fills in the post form and publishes it (or saves a draft): it **writes to your real account**. `me` and `works` are read-only: your profile counts and your own works with their stats. You must be signed in to `creator.douyin.com` in the browser chrome-use drives.

## Commands

```sh
# Publish (chrome-use 1.5.149+): upload, fill in, click 发布
chrome-use site douyin-creator/video-publish --video ./video.mp4 --until-done \
  --title "让 Claude Code 和 Codex 互相叫醒" \
  --description @desc.txt \
  --topics "AI编程,ClaudeCode,程序员" \
  --declaration ai --visibility public      # add --draft true to save a draft instead

# Older chrome-use: upload first, then fill in (re-run while it says incomplete / uploading)
chrome-use open https://creator.douyin.com/creator-micro/content/upload
chrome-use upload 'input[type=file]' ./video.mp4     # the page moves on to /content/post/video by itself
chrome-use site douyin-creator/video-publish --title "…" --description "$(cat desc.txt)" --topics "…"

# Read-only
chrome-use site douyin-creator/me
chrome-use site douyin-creator/works --limit 50
chrome-use site douyin-creator/works --limit 500 --visibility public
chrome-use site douyin-creator/works --cursor 1661351824000      # resume after an error
```

## Adapters

| adapter | args | returns / does |
| --- | --- | --- |
| `douyin-creator/video-publish` | `[--video FILE] --title T [--description D] [--topics a,b] [--declaration K] [--visibility V] [--draft true] [--video_url URL]` | Writes. Opens the upload page, hands the file over, and once Douyin has moved to the post page fills in title, description, topics, 自主声明 and 谁可以看, then clicks 发布 (or 暂存离开). Returns `{ok, status, title, topics, skipped_topics, declaration, visibility, warnings, url, note}` or `{error, hint}`. See the arg and status tables below. |
| `douyin-creator/me` | — | `uid`, `nickname`, `douyin_id` (抖音号: the custom one when set, else the numeric short id), `sec_uid`, `signature`, `followers`, `following`, `works` (private works included), `total_likes`, `avatar`, `profile_url`. `GET /web/api/media/user/info/`. |
| `douyin-creator/works` | `[--limit N] [--visibility V] [--cursor C]` | The creator center's `GET /janus/douyin/creator/pc/work_list`, newest first. `limit` default 50, max 500; `visibility` `all` (default) / `public` / `private`, filtered after fetching; `cursor` resumes from a `next_cursor`. Returns `count`, `total`, `has_more`, `next_cursor`, `error` (only when a later page failed), `works`. Each work: `aweme_id`, `title`, `desc`, `created_at`, `duration_sec`, `visibility` (`public`/`private`), `in_review`, `plays`, `likes`, `comments`, `shares`, `collects`, `url`. Private works report 0 plays. |

### `video-publish` arguments

| arg | values |
| --- | --- |
| `--video` | local video file (chrome-use 1.5.149+); use with `--until-done`, since Douyin navigates to the post page once the upload starts. Skipped when the tab is already on the post page with a video uploaded |
| `--title` | 作品标题, at most 30 characters. Required unless `--video_url` is given |
| `--description` | 作品简介, at most 1000 characters; newlines become new lines |
| `--topics` | comma-separated, `#` optional. Each is typed as `#name` and picked from Douyin's suggestion list by exact name (then case-insensitively). A name Douyin has no topic for is taken back out and reported in `skipped_topics` |
| `--declaration` | 自主声明: `ai` 内容由AI生成, `opinion` 内容为个人观点或见解, `repost` 内容为转载信息 (declared 取材站外), `promo` 内容含营销推广信息, `fiction` 虚构演绎，仅供娱乐, `none` 无需添加自主声明. Omit to leave it unset |
| `--visibility` | `public` (default) 公开, `friends` 好友可见, `private` 仅自己可见 |
| `--draft` | `true` clicks 暂存离开 instead of 发布 |
| `--video_url` | upload page only, instead of `chrome-use upload`: fetch an https URL in the page and hand it to the file input. The host must send CORS headers and the file must download in a few seconds. **GitHub release assets do not work** (no `Access-Control-Allow-Origin`, checked 2026-09-30). Run again without it once the page is on the post page |

### `video-publish` statuses

| `status` | meaning |
| --- | --- |
| `published` | the page moved to the content manager; the work shows 审核中 until review passes |
| `draft` | 暂存离开 went through. Douyin keeps one unfinished video; the upload page then offers 继续编辑 (resume) / 放弃 (discard) |
| `incomplete` | ran out of its time budget (or just started the upload / opened the upload page) before finishing; `stopped_at` and `done` (or `step` for the upload steps) say where. Run the same command again: every step checks what is already there, so nothing is doubled |
| `uploading` | the video is still uploading (`upload_percent`); nothing was filled in. Run again later |
| `upload_started` | `--video_url` handed the file over; run again without `--video_url` |
| `publish_clicked` / `draft_clicked` | the button was clicked but the page had not moved on by the deadline, or (`publish_clicked` with `ok: false`) a run in this tab already clicked publish for the same file in the last 15 minutes. **Check the content manager before running again: a re-run could post twice** |

`warnings` carries the 发文助手 quick-check findings (for example 横/竖双封面缺失, 作品原创性不足); they never block.

How `video-publish` works:

- **It drives the page's own form**, never Douyin's signed APIs: the title through the input's value setter plus an `input` event, the description through `execCommand('insertText')` and a synthetic Enter in the contenteditable `.editor-kit-container`, topics by clicking the suggestion item, 自主声明 in its dialog, 谁可以看 by its radio labels.
- **Upload finished** is read from the uploader component's React state (`uploadStatus` 1 uploading, 2 done, -1 failed). "上传成功" is only a toast, so it is no marker.
- **The editor syncs its caret on `selectionchange`, which is asynchronous.** The adapter puts the caret inside the last text leaf and yields before every edit; otherwise text lands at a stale position.
- **chrome-use gives an adapter about 8 s** (longer with chrome-use 1.5.149+, which passes the budget). The adapter stops at a safe point with `status: "incomplete"` rather than being cut off mid-click.
- A captcha, slider or SMS check stops the run with an error. It is never worked around.

`works` notes: the server sends about six works per page whatever the page size, so a 200-work account is ~35 requests (~30 s). A dropped request is retried once; if it fails again you get the works so far, `error`, and `next_cursor` to resume.

## Safety / testing

- `video-publish` posts to your real account, and Douyin acts on scripted behaviour. One run = one video.
- A live check is **one run per adapter, one page, never a loop**, and only as a private draft on a throwaway clip: `--draft true --visibility private`, then discard it with 放弃 on the upload page. Never publish, never touch existing works.
- Develop against `douyin-creator/fixtures/` (captured post page, upload page, topic suggestions, declaration dialog, `user_info` and `work_list` responses) and the stubbed tests.
- On `publish_clicked` / `draft_clicked`, look at the content manager or upload page before re-running.

## Tests

`node --test douyin-creator/`

See [CHANGELOG](../CHANGELOG.md) for changes.
