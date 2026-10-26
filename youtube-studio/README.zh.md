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

- chrome-use 1.5.253+ 上，点击、打字和按键都走 `args.ui`：由 daemon 发真实的鼠标和键盘事件（trusted），按人的节奏来。标题和简介先点进去，全选 + Backspace 清空后再打字；本次运行剩余时间打不完的长文本改为直接插入。某次 `ui` 调用失败（比如元素被横幅挡住）时，退回合成事件，并记进结果的 `ui_fallbacks`。
- 更早的 chrome-use 仍在 Studio 自己的对话框上用合成事件。Studio 是 shady DOM 上的 Polymer，它的点击处理认的是 DOM `click()`；标题和简介是全选后用一次 `execCommand('insertText')` 写进去的。
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

### 核对和上传缩略图

`video-upload` 默认采用 `--cover-mode review`：公开或不公开列出的发布会停在
`cover_selection_required`。核对平台缩略图后明确传入 `--cover-mode keep`，
或用 `--cover ./cover.png --cover-mode upload` 上传自定义图片。
上传仅定位图片输入框，必须看到已更换且可见的自定义缩略图预览；只确认文件送达
还不算设置成功，会返回 `cover_confirmation_required` 并停止发布。
仍可保存为私密视频，但会提醒在更改可见性前核对缩略图。
平台 AI／指定帧选择及修改已发布作品缩略图暂未实现。本改动经过离线样本测试，
没有修改真实频道。

没有 `elementRelayUpload` 能力的已发布 CLI 会使用已知且唯一的缩略图选择器，沿用普通 relay 上传路径，不添加 DOM 标记。

## 从本地视频指定帧

兼容的 CLI 安装 FFmpeg 后，原生适配器支持
`--cover-mode frame:1.5 --cover-video ./clip.mp4 --cover-output ./cover-1.5.png`。
时间为本地视频中的明确秒数。CLI 截取一张 PNG，保留作核对用的文件，再走现有图片
上传和预览核验流程。抖音会将同一帧交给两个比例分别裁剪；需要不同横、竖图时仍用
upload 模式分别传图片。

输出必须是尚不存在的 `.png`，不会覆盖已有文件。没有对应帧、FFmpeg 不可用等情况
会在浏览器操作前失败。近黑、近纯色画面会停下要求核对；看过图片后，只有明确传
`--allow-dark-cover true` 并使用新输出路径，才会接受该提示。这只是像素启发式检查，
不是封面质量评价。本地截帧不触发平台 AI，也不操作平台时间轴。旧 CLI 没有这项预处理，
需先升级。
