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
