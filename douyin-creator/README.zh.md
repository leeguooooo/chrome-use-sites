# `douyin-creator/` — 在抖音创作者中心发视频、读自己的账号

[English](README.md) · 中文

在抖音创作者中心 `creator.douyin.com` 上，以浏览器里登录的账号操作。`video-publish` 上传视频、填好发布表单并发布（或存草稿），**会写入你的真实账号**。`me` 和 `works` 只读：账号数据，以及自己作品的列表和数据。需要先在 chrome-use 控制的浏览器里登录 `creator.douyin.com`。

## 命令

```sh
# 发布（chrome-use 1.5.149+）：上传、填写、点「发布」
chrome-use site douyin-creator/video-publish --video ./video.mp4 --until-done \
  --title "让 Claude Code 和 Codex 互相叫醒" \
  --description @desc.txt \
  --topics "AI编程,ClaudeCode,程序员" \
  --declaration ai --visibility public      # 加 --draft true 改成存草稿

# 旧版 chrome-use：先上传，再填写（返回 incomplete / uploading 时重跑）
chrome-use open https://creator.douyin.com/creator-micro/content/upload
chrome-use upload 'input[type=file]' ./video.mp4     # 页面会自己跳到 /content/post/video
chrome-use site douyin-creator/video-publish --title "…" --description "$(cat desc.txt)" --topics "…"

# 只读
chrome-use site douyin-creator/me
chrome-use site douyin-creator/works --limit 50
chrome-use site douyin-creator/works --limit 500 --visibility public
chrome-use site douyin-creator/works --cursor 1661351824000      # 出错后从这里续
```

## Adapter 一览

| adapter | 参数 | 返回 / 作用 |
| --- | --- | --- |
| `douyin-creator/video-publish` | `[--video FILE] --title T [--description D] [--topics a,b] [--declaration K] [--visibility V] [--draft true] [--video_url URL]` | 有写操作。打开上传页、交给它文件，等抖音跳到发布页后填写标题、简介、话题、自主声明和「谁可以看」，再点「发布」（或「暂存离开」）。返回 `{ok, status, title, topics, skipped_topics, declaration, visibility, warnings, url, note}` 或 `{error, hint}`。参数和状态见下面两张表。 |
| `douyin-creator/me` | — | `uid`、`nickname`、`douyin_id`（抖音号，设置过自定义的用自定义的，否则是数字短 id）、`sec_uid`、`signature`、`followers`、`following`、`works`（含私密作品）、`total_likes`、`avatar`、`profile_url`。请求 `GET /web/api/media/user/info/`。 |
| `douyin-creator/works` | `[--limit N] [--visibility V] [--cursor C]` | 创作者中心的 `GET /janus/douyin/creator/pc/work_list`，按时间倒序。`limit` 默认 50，最多 500；`visibility` 取 `all`（默认）/ `public` / `private`，拉下来之后再过滤；`cursor` 用上次的 `next_cursor` 续翻。返回 `count`、`total`、`has_more`、`next_cursor`、`error`（只有后面某页失败时才有）、`works`。每条作品：`aweme_id`、`title`、`desc`、`created_at`、`duration_sec`、`visibility`（`public`/`private`）、`in_review`、`plays`、`likes`、`comments`、`shares`、`collects`、`url`。私密作品的播放数是 0。 |

### `video-publish` 参数

| 参数 | 取值 |
| --- | --- |
| `--video` | 本地视频文件（chrome-use 1.5.149+），配合 `--until-done` 用，因为上传一开始抖音就会跳到发布页。如果当前标签页已经在发布页并且视频已上传，就跳过 |
| `--title` | 作品标题，最多 30 个字。除非给了 `--video_url`，否则必填 |
| `--description` | 作品简介，最多 1000 个字，换行照样换行 |
| `--topics` | 逗号分隔，`#` 可写可不写。每个话题以 `#名字` 输入，在抖音的联想列表里按名字精确匹配（找不到再忽略大小写）。抖音没有的话题会被删掉，放进 `skipped_topics` |
| `--declaration` | 自主声明：`ai` 内容由AI生成、`opinion` 内容为个人观点或见解、`repost` 内容为转载信息（选「取材站外」）、`promo` 内容含营销推广信息、`fiction` 虚构演绎，仅供娱乐、`none` 无需添加自主声明。不传就不设置 |
| `--visibility` | `public`（默认）公开、`friends` 好友可见、`private` 仅自己可见 |
| `--draft` | `true` 时点「暂存离开」而不是「发布」 |
| `--video_url` | 只在上传页用，代替 `chrome-use upload`：在页面里下载一个 https 链接再交给文件输入框。对方必须返回 CORS 头，而且几秒内能下完。**GitHub release 附件不行**（没有 `Access-Control-Allow-Origin`，2026-09-30 验证）。页面到了发布页后，去掉这个参数再跑一次 |

### `video-publish` 返回状态

| `status` | 含义 |
| --- | --- |
| `published` | 页面已跳到作品管理；审核通过前作品显示「审核中」 |
| `draft` | 已暂存。抖音只保留一个未发布的视频，之后上传页会出现「继续编辑」/「放弃」 |
| `incomplete` | 时间用完（或刚打开上传页、刚开始上传），还没做完；`stopped_at` 和 `done`（上传阶段是 `step`）说明停在哪一步。原样再跑一次即可，每一步都会先看页面上已有什么，不会重复填 |
| `uploading` | 视频还在上传（`upload_percent`），什么都没填。过一会儿再跑 |
| `upload_started` | `--video_url` 已把文件交给页面；去掉 `--video_url` 再跑 |
| `publish_clicked` / `draft_clicked` | 按钮点了，但到时限页面还没跳转；或者（`publish_clicked` 且 `ok: false`）这个标签页 15 分钟内已经为同一个文件点过发布。**先去作品管理页看一眼再决定要不要重跑，重跑可能发两次** |

`warnings` 里是「发文助手」的检测结果（比如 横/竖双封面缺失、作品原创性不足），只提示，不拦截。

`video-publish` 的实现方式：

- **操作的是页面自己的表单**，不调抖音带签名的接口：标题用 input 的 value setter 加 `input` 事件；简介在可编辑的 `.editor-kit-container` 里用 `execCommand('insertText')` 和模拟回车；话题点联想列表里的条目；自主声明在弹窗里选；「谁可以看」点单选标签。
- **上传是否完成**读上传组件的 React state（`uploadStatus` 1 上传中、2 完成、-1 失败）。「上传成功」只是一个一闪而过的 toast，不能当依据。
- **编辑器在 `selectionchange` 时才同步光标，而且是异步的。** adapter 每次编辑前把光标放进最后一个文本节点并让出一次事件循环，否则文字会插到旧位置。
- **chrome-use 给每个 adapter 大约 8 秒**（chrome-use 1.5.149+ 会把预算传进来，可以更长）。时间不够时 adapter 在安全的位置停下并返回 `status: "incomplete"`，不会点到一半被掐断。
- 遇到验证码、滑块或短信验证就报错停止，不会去绕过。

`works` 补充：不管 page_size 设多少，服务端每页大约只给 6 条，所以 200 条作品的账号约 35 个请求（约 30 秒）。请求掉线会重试一次；还失败就返回已拿到的作品、`error` 和用来续翻的 `next_cursor`。

## 安全与测试

- `video-publish` 发到你的真实账号，抖音会处理脚本行为。一次运行 = 一个视频。
- 真机验证**每个 adapter 只跑一次、只操作一页、不循环**，而且只能用一段测试短片存私密草稿：`--draft true --visibility private`，然后在上传页点「放弃」丢掉草稿。不要真的发布，也不要碰已有作品。
- 平时开发用 `douyin-creator/fixtures/`（抓下来的发布页、上传页、话题联想、自主声明弹窗，以及 `user_info`、`work_list` 响应）和打桩测试。
- 返回 `publish_clicked` / `draft_clicked` 时，先去作品管理页或上传页确认，再决定是否重跑。

## 测试

`node --test douyin-creator/`

改动记录见 [CHANGELOG](../CHANGELOG.md)。

### 发布前核对双封面

`video-publish` 默认采用 `--cover-mode review`，点击发布前返回
`cover_selection_required` 和两个封面槽。先在平台编辑器里核对横版 4:3、
竖版 3:4，再明确传入 `--cover-mode keep`。仍可用 `--draft true` 保存草稿后改封面。
适配器不会静默批准默认首帧。自动上传、AI 选择、任意截帧及修改已发布作品的封面
还缺少已验证的编辑器样本，暂不支持，调用时会明确拒绝。

## 分别选择横、竖封面

`douyin-creator/cover-select` 只操作刚上传视频的新建表单，分别上传 JPG/PNG
横、竖封面，确认编辑器并检查两张预览已变化。它不发布、不暂存、不生成 AI 封面、
不选择视频帧，也不修改已有作品。上传需要 CLI 的 `file.elementRelayUpload`
能力；已发布的 1.5.265 尚不具备这项能力。

```sh
chrome-use site douyin-creator/cover-select --cover-portrait ./portrait.png \
  --cover-landscape ./landscape.png --cover-mode upload
```

不传文件时，默认 `review` 返回两张预览是否已加载；`keep` 明确接受当前预览，
缺少任何一张都会拒绝。传入文件时不能选择 review/keep。只有两张封面确认后均显示
新预览，才返回 `covers_selected`。中途停止会返回 `cover_confirmation_required`
及编辑器中已准备的比例；表单可能已有部分改动，请先检查再重试。已有编辑器未关闭时会拒绝
开始，不支持的页面和模式也会在操作前拒绝。

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

`video-publish` 会在操作表单前拒绝尚未接入的封面文件／截帧参数。请先用 `cover-select`，检查预览后再明确传 `--cover-mode keep` 投稿。`--cover` 与 keep 同时出现时不会静默忽略文件。
