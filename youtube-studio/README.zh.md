# `youtube-studio/` — 在 YouTube Studio 上传视频、读取频道数据

[English](README.md) · 中文

两个 adapter，对应 `studio.youtube.com`。`video-upload` 上传本地视频，填好 Studio 的上传对话框并发布，也能改已发布视频的公开范围。`channel` 只读，返回频道总数和上传列表。`video-upload` 会真的发到你的频道上。chrome-use 驱动的浏览器里要先登录 studio.youtube.com。

## 命令

```sh
# 一条命令上传并发布（chrome-use 1.5.149+）
chrome-use open https://studio.youtube.com
chrome-use site youtube-studio/video-upload --video ./video.mp4 --until-done \
  --title "让 Claude Code 和 Codex 互相叫醒" --description @desc.txt \
  --visibility private --made_for_kids false --ai_altered no \
  --category 科学和技术 --tags "Claude Code,Codex" --language zh-Hans

# 旧版 chrome-use：先上传，再填对话框（返回 uploading / processing / checking 时重跑）
chrome-use open 'https://studio.youtube.com/channel/<channel id>/videos/upload?d=ud'
chrome-use upload 'input[type=file]' ./video.mp4
chrome-use site youtube-studio/video-upload --title "…" --description "$(cat desc.txt)" --visibility private

# 之后在视频的编辑页只改公开范围
chrome-use open https://studio.youtube.com/video/<video id>/edit
chrome-use site youtube-studio/video-upload --visibility public

# 频道总数和上传列表（只读）
chrome-use site youtube-studio/channel             # 总数 + 最新 30 个上传
chrome-use site youtube-studio/channel --limit 0   # 只要总数
```

## Adapter 一览

| adapter | 参数 | 返回 / 作用 |
| --- | --- | --- |
| `youtube-studio/video-upload` | `--video`、`--title`、`--description`、`--visibility`、`--made_for_kids`、`--ai_altered`、`--category`、`--tags`、`--playlist`、`--language`、`--allow_embed`、`--wait_checks`（都可选） | 上传文件，填上传对话框（详细信息、高级设置、公开范围）并发布。返回 `{ok, status, url, visibility, title, warnings, done}` 或 `{error, hint}`。在视频编辑页上只处理 `--visibility`。会写入 |
| `youtube-studio/channel` | `--limit`（默认 30，最大 500，`0` 只返回总数） | 只读。返回 `channel_id`、`title`、`custom_url`、`url`、`subscribers`、`videos`、`total_views` 和 `uploads` |

### `video-upload` 参数

| 参数 | 取值 |
| --- | --- |
| `--video` | 本地视频文件（需要 chrome-use 1.5.149+）。adapter 自己打开频道的上传对话框并把文件交过去。配合 `--until-done` 用 |
| `--title` | 最多 100 字，不能有 `<` `>`。不传就用 Studio 默认的标题（文件名） |
| `--description` | 最多 5000 字，不能有 `<` `>`，换行会保留 |
| `--visibility` | `private`（默认）、`unlisted`、`public` |
| `--made_for_kids` | `false`（默认）或 `true`。不回答这一项，Studio 不让离开“详细信息” |
| `--ai_altered` | `yes` / `no`，回答“是否为经过修改或合成的内容”（逼真的人物、事件、地点）。不传就不回答 |
| `--category` | Studio 里显示的类别名（科学和技术），或 id 后缀（`SCIENCE`、`EDUCATION` …） |
| `--tags` | 逗号分隔，合计最多 500 字符。缺的标签会补上，视频上已有的标签保留 |
| `--playlist` | 已有播放列表的名字，会勾上它。名字找不到只给 warning |
| `--language` | 视频语言，写代码（`zh-Hans`、`en`）或菜单里的名字 |
| `--allow_embed` | `true`（默认）/ `false` |
| `--wait_checks` | `true`（默认）等上传、处理和版权检查都结束才发布；`false` 上传完就发布 |

### `--until-done` 的流程

带 `--video` 时，标签页要停在 `studio.youtube.com/channel/UC…` 这类页面上，adapter 才知道传到哪个频道。每次运行只有约 7 秒，到点会在安全的位置停下并返回状态。状态是 `incomplete`、`uploading`、`processing` 或 `checking` 时，`--until-done` 会用同样的参数重跑。adapter 自带的超时是 30 分钟，可以用 `--timeout 60m` 加长，或者传 `--wait_checks false`，上传一完成就发布。每一步动手前都先检查，所以重跑会接着做，不会把文字或标签重复填一遍。

### `video-upload` 的状态

| status | 含义 |
| --- | --- |
| `saved` / `published` | 对话框已关闭。`private` 返回 `saved`，`unlisted` / `public` 返回 `published` |
| `uploading` / `processing` / `checking` | 详细信息已填好，还没发布。附带 `percent`、Studio 的 `progress` 文字和 `checks` |
| `incomplete` | 这次运行时间用完了（`stopped_at` 写了停在哪一步），再跑一次 |
| `visibility_changed` / `unchanged` | 编辑页：公开范围已改，或本来就是这个值 |
| `save_clicked` | 编辑页：点了“保存”但没来得及确认生效。刷新编辑页看一下 |
| `confirm_needed` | 点发布后 Studio 弹出“仍在检查 / 处理”的确认框，需要手动处理 |
| `publish_clicked` | 点了发布但对话框没在时限内关闭，或者这个标签页里之前的运行已经为同一个文件点过发布。重跑前先去“内容”页看 |

`url` 是 `https://youtu.be/<id>`，取自对话框的 `video-id`。检查结果不是“未发现任何问题”时（比如有版权声明），会写进 `warnings`。“如需提供可点击的外部链接，请先完成一次性验证”这类提示也会放进去，意思是频道还没做手机验证。adapter 只报告，不会去验证。

### `channel` 字段

调用 Studio 自己的 `creator/get_creator_channels` 和 `creator/list_creator_videos`，带上 Studio 用的 SAPISIDHASH。`uploads` 里每一项有 `video_id`、`title`、`type`（`video` / `short`）、`visibility`（`public` / `unlisted` / `private` / `draft`）、`published_at`、`duration_sec`、`views`、`likes`、`comments`、`url`。和 Studio 的“视频”页不同，列表里包含 Shorts。按 `nextPageToken` 翻页。某一页出错时，返回已拿到的部分，并附上 `uploads_error`。

### `video-upload` 的实现方式

- 只在 Studio 自己的对话框上触发真实 DOM 事件。Studio 是 shady DOM 上的 Polymer，它的点击处理认的是 DOM `click()`。
- 标题和简介是全选后用一次 `execCommand('insertText')` 写进去的。
- 进度从 `ytcp-video-upload-progress` 读取。
- 在 详细信息 → 视频元素 → 检查 → 公开范围 之间切换时，每一步的 DOM 会重建，但 Studio 会保留填过的值。已经按这组参数核对过详细信息的运行会给对话框打个标记；没有标记的运行会先回到“详细信息”把每一项核对一遍。
- 遇到人机验证或身份验证就报错停下，需要手动处理。

## 安全与测试

`video-upload` 会发布到你真实的 YouTube 频道。

- 开发时用 `youtube-studio/fixtures/` 和 stub 过的测试，不要对线上页面反复试。
- 线上验证只上传用户要求发布的视频，并且先用 `--visibility private`。确认视频没问题后，再到编辑页改公开范围。
- 不要动频道里的其他视频。
- 返回 `publish_clicked` 时，先去“内容”页确认，再决定要不要重跑。
- 遇到人机验证或身份验证，停下来手动处理，不要循环重跑。

`channel` 只读。

## 测试

`node --test youtube-studio/`

改动记录见 [CHANGELOG](../CHANGELOG.md)。
