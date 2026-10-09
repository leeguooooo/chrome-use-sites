# `bilibili-creator/` — publish videos on Bilibili (投稿)

English · [中文](README.zh.md)

One adapter for Bilibili's creator center at `member.bilibili.com`. `video-publish` uploads a local video, fills in the 投稿 form, and clicks 立即投稿 to publish, or 存草稿 to save a draft. It writes to your real account. You must be signed in to member.bilibili.com in the browser chrome-use drives. Account reads (`bilibili/me`, `bilibili/user-videos`, `bilibili/creator-stats`) are not in this repo. They come from the community pack / OpenCLI.

## Commands

```sh
# check the filled form first (optional): --submit false stops before 立即投稿
chrome-use site bilibili-creator/video-publish --video ./video.mp4 --until-done \
  --title "让 Claude Code 和 Codex 互相叫醒" --description @desc.txt \
  --tags "Claude Code,Codex,AI编程,开源" --category 科技数码 \
  --type self --declaration ai --submit false
# then run the same arguments again without --video and --submit false, with --until-done

# older chrome-use: upload first, then fill the form (re-run while it says incomplete / uploading)
chrome-use open https://member.bilibili.com/platform/upload/video/frame
chrome-use upload '.bcc-upload-wrapper input[type=file]' ./video.mp4
chrome-use site bilibili-creator/video-publish --title "…" --description "$(cat desc.txt)" --tags "…"
```

## Adapters

| adapter | args | returns / does |
| --- | --- | --- |
| `bilibili-creator/video-publish` | `--title` and `--tags` (required); `--video`, `--description`, `--category`, `--type`, `--source`, `--declaration`, `--visibility`, `--draft`, `--submit` | Uploads the file, fills the 投稿 form and clicks 立即投稿 (or 存草稿). Returns `{ok, status, bvid, url, tags, skipped_tags, removed_tags, statement, self_made, category, visibility, cover, warnings}` or `{error, hint}`. Writes. |

### Arguments

| arg | values |
| --- | --- |
| `--video` | local video file (needs chrome-use 1.5.149+). The adapter opens the 投稿 page and hands the file over. Use it with `--until-done` |
| `--title` | required, at most 80 characters |
| `--description` | 简介, at most 2000 characters. Newlines become paragraphs |
| `--tags` | required, comma-separated, 1 to 10, each at most 20 characters. A tag found in 推荐标签 is clicked there, and the rest are typed and entered. Tags already on the form that are not listed are removed (Bilibili pre-fills some) |
| `--category` | 分区 as the menu shows it. The menu is flat now (科技数码, 人工智能, 知识 …). A path like `科技 → 计算机技术` is matched segment by segment and lands on 科技数码, with a warning. Omit it to keep Bilibili's pick |
| `--type` | `self` (default) ticks 内容为自制：未经作者允许，禁止转载. `repost` picks 内容为转载 and needs `--source` |
| `--source` | 转载来源 (URL or name). Required with `--type repost` |
| `--declaration` | 创作声明: `ai` 含AI生成内容, `fiction` 含虚构演绎内容, `promo` 内容含营销信息, `opinion` 个人观点，仅供参考, `none` 内容无需标注. Omit it to keep the current one (`none` if the field is empty). It shares one menu with 内容为转载, so it cannot be combined with `--type repost` |
| `--visibility` | `public` (default, 公开可见) / `private` (仅自己可见) |
| `--draft` | `true` clicks 存草稿 instead of 立即投稿 |
| `--submit` | `false` fills everything and clicks nothing, so you can look at the form first |

### Statuses

| status | meaning |
| --- | --- |
| `submitted` | published. Comes with `bvid` and `url` (`https://www.bilibili.com/video/<bvid>`). The video stays 审核中 until Bilibili approves it |
| `draft` | saved with 存草稿 |
| `filled` | `--submit false`: form filled and file uploaded, nothing clicked |
| `uploading` | form filled, file not finished yet (`upload_percent`). Re-run |
| `incomplete` | out of time for this run (`stopped_at` says where). Nothing was submitted. Re-run |
| `dialog` | Bilibili opened a confirmation after the click. It is reported, never answered |
| `already_submitted` | the tab already shows a finished submit |
| `submit_clicked` / `draft_clicked` | clicked, but no success screen showed in time. Check 内容管理 → 稿件管理 before re-running, or it could post twice |
| `publish_clicked` | a run in this tab already clicked publish for the same file in the last 15 minutes, so the file is not uploaded again. Use a new tab to publish it again |

### How it works

- It uses real DOM events only, on the page's own widgets. It makes no Bilibili API calls. Vue component state is only read: whether the 自制 box is ticked, and `completeBvid` after the submit.
- Bilibili checks each tag when it is entered. A refusal shows up as a toast and lands in `skipped_tags` with its text, e.g. 程序员: 当前tag为话题专用，不允许自定义添加. Topic-only tags are joined via 参与话题, which this adapter does not do.
- 简介 is a Quill editor. Each line goes in with `execCommand('insertText')` and each paragraph with an Enter key, then the text is read back and compared.
- Cover: Bilibili's cover is kept. If the slot is still empty, the first recommended frame is clicked.
- Each run has about 7 seconds. Each step checks before it acts, so a re-run continues without adding tags or text twice. Typed tags take about half a second each, so a first run with many tags usually stops once with `incomplete`.
- If several files (分P) are queued, all of them are submitted together, with a warning.
- A captcha, geetest or 安全验证 stops the run with an error.

## Safety / testing

This publishes to your real Bilibili account. Bilibili is treated like Xiaohongshu:

- One live run per adapter, never a loop.
- Develop against `bilibili-creator/fixtures/` with the stubbed tests.
- Publish only a video the user asked to publish. Never touch the account's other videos.
- Use `--submit false` to check the filled form before the real submit.
- If a run reports `submit_clicked` or `publish_clicked`, check 稿件管理 before running again.
- On a captcha or verification, stop and clear it by hand. Do not re-run in a loop.

The live check so far was one real publish (BV1fqad6TET7): filled once with `--submit false`, then submitted.

## Tests

`node --test bilibili-creator/`

See [CHANGELOG](../CHANGELOG.md) for changes.
