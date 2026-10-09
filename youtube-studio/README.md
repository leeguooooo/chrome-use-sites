# `youtube-studio/` — upload videos and read your channel in YouTube Studio

English · [中文](README.zh.md)

Two adapters for `studio.youtube.com`. `video-upload` uploads a local video, fills in Studio's upload dialog and publishes it. It can also change the visibility of a video you already published. `channel` is read-only and returns your channel totals and uploads. `video-upload` writes to your real channel. You must be signed in to studio.youtube.com in the browser chrome-use drives.

## Commands

```sh
# upload and publish in one command (chrome-use 1.5.149+)
chrome-use open https://studio.youtube.com
chrome-use site youtube-studio/video-upload --video ./video.mp4 --until-done \
  --title "让 Claude Code 和 Codex 互相叫醒" --description @desc.txt \
  --visibility private --made_for_kids false --ai_altered no \
  --category 科学和技术 --tags "Claude Code,Codex" --language zh-Hans

# older chrome-use: upload first, then fill the dialog (re-run while it says uploading / processing / checking)
chrome-use open 'https://studio.youtube.com/channel/<channel id>/videos/upload?d=ud'
chrome-use upload 'input[type=file]' ./video.mp4
chrome-use site youtube-studio/video-upload --title "…" --description "$(cat desc.txt)" --visibility private

# later, on the video's edit page, change only the visibility
chrome-use open https://studio.youtube.com/video/<video id>/edit
chrome-use site youtube-studio/video-upload --visibility public

# channel totals and uploads (read-only)
chrome-use site youtube-studio/channel             # totals + 30 newest uploads
chrome-use site youtube-studio/channel --limit 0   # totals only
```

## Adapters

| adapter | args | returns / does |
| --- | --- | --- |
| `youtube-studio/video-upload` | `--video`, `--title`, `--description`, `--visibility`, `--made_for_kids`, `--ai_altered`, `--category`, `--tags`, `--playlist`, `--language`, `--allow_embed`, `--wait_checks` (all optional) | Uploads the file, fills the upload dialog (details, advanced settings, visibility) and publishes. Returns `{ok, status, url, visibility, title, warnings, done}` or `{error, hint}`. On a video's edit page it applies only `--visibility`. Writes. |
| `youtube-studio/channel` | `--limit` (default 30, max 500, `0` = totals only) | Read-only. Returns `channel_id`, `title`, `custom_url`, `url`, `subscribers`, `videos`, `total_views` and `uploads` |

### `video-upload` arguments

| arg | values |
| --- | --- |
| `--video` | local video file (needs chrome-use 1.5.149+). The adapter opens the channel's upload dialog and hands the file over. Use it with `--until-done` |
| `--title` | at most 100 characters, no `<` `>`. Omit it to keep Studio's title (the file name) |
| `--description` | at most 5000 characters, no `<` `>`. Newlines are kept |
| `--visibility` | `private` (default), `unlisted`, `public` |
| `--made_for_kids` | `false` (default) or `true`. Studio will not go past Details without it |
| `--ai_altered` | `yes` / `no`: the altered or synthetic content question (realistic people, events, places). Omit it to leave the question unanswered |
| `--category` | display name as Studio shows it (科学和技术) or the id suffix (`SCIENCE`, `EDUCATION`, …) |
| `--tags` | comma-separated, at most 500 characters in total. Missing tags are added and tags already on the video are kept |
| `--playlist` | name of an existing playlist to tick. An unknown name gives a warning |
| `--language` | video language as a code (`zh-Hans`, `en`) or its name in the menu |
| `--allow_embed` | `true` (default) / `false` |
| `--wait_checks` | `true` (default) publishes only after the upload, processing and copyright checks finish. `false` publishes once the upload is done |

### The `--until-done` flow

With `--video`, the tab must be on a `studio.youtube.com/channel/UC…` page so the adapter knows which channel to upload to. Each run has about 7 seconds. It stops at a safe point and returns a status. `--until-done` re-runs the same command while the status is `incomplete`, `uploading`, `processing` or `checking`. The adapter's timeout is 30 minutes. Raise it with `--timeout 60m`, or pass `--wait_checks false` to publish as soon as the upload is complete. Every step checks before it acts, so a re-run continues without adding the text or tags twice.

### `video-upload` statuses

| status | meaning |
| --- | --- |
| `saved` / `published` | the dialog closed. `saved` for `private`, `published` for `unlisted` / `public` |
| `uploading` / `processing` / `checking` | details are filled, nothing is published yet. Comes with `percent`, Studio's `progress` text and `checks` |
| `incomplete` | out of time for this run (`stopped_at` says where). Re-run it |
| `visibility_changed` / `unchanged` | edit page: the visibility was changed, or already matched |
| `save_clicked` | edit page: 保存 was clicked but did not settle in time. Reload the edit page and check |
| `confirm_needed` | after publish Studio asked a "still checking / processing" question. Answer it by hand |
| `publish_clicked` | publish was clicked but the dialog did not close in time, or a run in this tab already clicked publish for the same file. Check the Content page before re-running |

`url` is `https://youtu.be/<id>`, built from the dialog's `video-id`. `warnings` holds the checks result when it is not 未发现任何问题 (for example a copyright claim). It also holds notices such as 如需提供可点击的外部链接，请先完成一次性验证, which means the channel is not phone-verified. The adapter reports this and never verifies the channel.

### `channel` fields

Calls Studio's own `creator/get_creator_channels` and `creator/list_creator_videos` with the SAPISIDHASH that Studio sends. Each entry in `uploads` has `video_id`, `title`, `type` (`video` / `short`), `visibility` (`public` / `unlisted` / `private` / `draft`), `published_at`, `duration_sec`, `views`, `likes`, `comments` and `url`. Unlike Studio's Videos tab, the list includes Shorts. It follows `nextPageToken`. If a page fails, the uploads so far are returned with `uploads_error`.

### How `video-upload` works

- It uses Studio's own dialog with real DOM events only. Studio is Polymer on shady DOM, so a DOM `click()` is what its tap handlers take.
- Title and description go in with one `execCommand('insertText')` over a select-all.
- Progress is read from `ytcp-video-upload-progress`.
- Moving between 详细信息 → 视频元素 → 检查 → 公开范围 rebuilds each step's DOM, and Studio keeps the values. A run that already verified the details for these arguments marks the dialog. A run without that mark goes back to 详细信息 and checks every field first.
- A captcha or identity check stops the run with an error. Clear it by hand.

## Safety / testing

`video-upload` publishes to your real YouTube channel.

- Develop against `youtube-studio/fixtures/` with the stubbed tests, not the live site.
- A live check uploads only a video the user asked to publish, and uses `--visibility private` first. Check the video, then change its visibility on the edit page.
- Never touch the channel's other videos.
- If a run reports `publish_clicked`, check the Content page before running it again.
- On a captcha or identity check, stop and clear it by hand. Do not re-run in a loop.

`channel` is read-only.

## Tests

`node --test youtube-studio/`

See [CHANGELOG](../CHANGELOG.md) for changes.
