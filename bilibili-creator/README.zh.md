# `bilibili-creator/` — 在 B 站投稿视频

[English](README.md) · 中文

一个 adapter，对应 B 站创作中心 `member.bilibili.com`。`video-publish` 上传本地视频，填好投稿表单，然后点“立即投稿”发布，或点“存草稿”。它会真的发到你的账号上。chrome-use 驱动的浏览器里要先登录 member.bilibili.com。账号数据的读取不在这个 pack：`bilibili/user-videos` 和 `bilibili/creator-stats` 在本仓库的 [`bilibili/`](../bilibili/) 里；`bilibili/me` 来自社区 pack。

## 命令

```sh
# 可选：先看填好的表单，--submit false 会停在“立即投稿”之前
chrome-use site bilibili-creator/video-publish --video ./video.mp4 --until-done \
  --title "让 Claude Code 和 Codex 互相叫醒" --description @desc.txt \
  --tags "Claude Code,Codex,AI编程,开源" --category 科技数码 \
  --type self --declaration ai --submit false
# 确认后用同样的参数再跑一次，去掉 --video 和 --submit false，保留 --until-done

# 旧版 chrome-use：先上传，再填表单（返回 incomplete / uploading 时重跑）
chrome-use open https://member.bilibili.com/platform/upload/video/frame
chrome-use upload '.bcc-upload-wrapper input[type=file]' ./video.mp4
chrome-use site bilibili-creator/video-publish --title "…" --description "$(cat desc.txt)" --tags "…"
```

## Adapter 一览

| adapter | 参数 | 返回 / 作用 |
| --- | --- | --- |
| `bilibili-creator/video-publish` | `--title`、`--tags`（必填）；`--video`、`--description`、`--category`、`--type`、`--source`、`--declaration`、`--visibility`、`--draft`、`--submit` | 上传文件，填投稿表单，点“立即投稿”（或“存草稿”）。返回 `{ok, status, bvid, url, tags, skipped_tags, removed_tags, statement, self_made, category, visibility, cover, warnings}` 或 `{error, hint}`。会写入 |

### 参数

| 参数 | 取值 |
| --- | --- |
| `--video` | 本地视频文件（需要 chrome-use 1.5.149+）。adapter 自己打开投稿页并把文件交过去。配合 `--until-done` 用 |
| `--title` | 必填，最多 80 字 |
| `--description` | 简介，最多 2000 字，换行会变成新段落 |
| `--tags` | 必填，逗号分隔，1 到 10 个，每个最多 20 字。在“推荐标签”里能找到的直接点，其余的手动输入回车。表单上已有、但不在列表里的标签会被删掉（B 站会预填一些） |
| `--category` | 分区名，按菜单里显示的写。现在菜单是平铺的（科技数码、人工智能、知识 …）。写成 `科技 → 计算机技术` 这种路径会逐段匹配，最后落到“科技数码”，并给出 warning。不传就保留 B 站自动选的 |
| `--type` | `self`（默认）：勾选“内容为自制：未经作者允许，禁止转载”。`repost`：选“内容为转载”，需要 `--source` |
| `--source` | 转载来源（链接或名称）。`--type repost` 时必填 |
| `--declaration` | 创作声明：`ai` 含AI生成内容、`fiction` 含虚构演绎内容、`promo` 内容含营销信息、`opinion` 个人观点，仅供参考、`none` 内容无需标注。不传就保留当前值（为空时填 `none`）。它和“内容为转载”在同一个菜单里，所以不能和 `--type repost` 一起用 |
| `--visibility` | `public`（默认，公开可见）/ `private`（仅自己可见） |
| `--draft` | `true` 时点“存草稿”而不是“立即投稿” |
| `--submit` | `false` 时全部填好但什么都不点，方便先检查表单 |

### 状态

| status | 含义 |
| --- | --- |
| `submitted` | 已投稿，附带 `bvid` 和 `url`（`https://www.bilibili.com/video/<bvid>`）。B 站审核通过前稿件显示“审核中” |
| `draft` | 已存草稿 |
| `filled` | `--submit false`：表单已填、文件已传完，没有点任何按钮 |
| `uploading` | 表单已填，文件还没传完（`upload_percent`），稍后重跑 |
| `incomplete` | 这次运行时间用完了（`stopped_at` 写了停在哪一步），没有提交任何东西，再跑一次 |
| `dialog` | 点击后 B 站弹了确认框。adapter 只报告，不会替你回答 |
| `already_submitted` | 当前标签页已经是投稿成功的页面 |
| `submit_clicked` / `draft_clicked` | 点了，但时限内没看到成功页。重跑前先去 内容管理 → 稿件管理 看，否则可能投两次 |
| `publish_clicked` | 这个标签页里 15 分钟内已经有一次运行为同一个文件点过发布，所以不会再上传。要再发同一个文件，换一个新标签页 |

### 实现方式

- 只操作页面自己的控件，不调用 B 站的 API。chrome-use 1.5.253 起，点击和键入都走 `args.ui`，是真实的鼠标和键盘输入（trusted 事件），按人的节奏来；更早的版本，或某次 ui 调用失败时，改用合成的 DOM 事件，结果里的 `ui_fallbacks` 会列出这些回退。Vue 组件的状态只读不写：读“自制”是否勾上，以及投稿后的 `completeBvid`。
- 标签在输入时由 B 站校验。被拒的会弹 toast，连同提示文字一起放进 `skipped_tags`，例如“程序员: 当前tag为话题专用，不允许自定义添加”。话题专用的标签要通过“参与话题”加，这个 adapter 不做。
- 简介是 Quill 编辑器：逐行键入（没有 `args.ui` 时用 `execCommand('insertText')`），每段之间按一次回车，写完读回来比对。
- 封面：保留 B 站给的。如果封面位还是空的，就点第一个推荐帧。
- 每次运行约 7 秒。每一步动手前先检查，所以重跑会接着做，不会重复加标签或文字。手动输入的标签每个大约半秒，标签多的话第一次运行通常会以 `incomplete` 停一次。
- 如果排队了多个文件（分P），会一起投稿，并给出 warning。
- 出现验证码、极验或“安全验证”时报错停下。

## 安全与测试

这会发布到你真实的 B 站账号。B 站按小红书的标准对待：

- 每个 adapter 线上只跑一次，绝不循环。
- 开发时用 `bilibili-creator/fixtures/` 和 stub 过的测试。
- 只发布用户要求发布的视频，不要动账号里的其他稿件。
- 正式投稿前可以先用 `--submit false` 检查表单。
- 返回 `submit_clicked` 或 `publish_clicked` 时，先去稿件管理确认，再决定要不要重跑。
- 遇到验证码或身份验证，停下来手动处理，不要循环重跑。

目前的线上验证是一次真实投稿（BV1fqad6TET7）：先用 `--submit false` 填了一次，再正式提交。

## 测试

`node --test bilibili-creator/`

改动记录见 [CHANGELOG](../CHANGELOG.md)。

### 选择封面

发布前需要明确选择封面。默认返回 `status: "cover_selection_required"` 和
`cover_candidates`，不会提交。`--cover-mode ai` 读取平台已有的推荐候选，
看过截图后再用从 1 开始的 `--cover-index` 选定；不会生成付费 AI 图片，也不会
静默选第一张。`--cover-mode keep` 接受你已在编辑器里核对过的封面，空封面仍会拒绝。
本适配器暂不支持上传封面、按任意时间截帧或修改已发布作品的封面。

```sh
chrome-use site bilibili-creator/video-publish --title "Hello" --tags a
chrome-use screenshot --selector .cover-ai
chrome-use site bilibili-creator/video-publish --title "Hello" --tags a --cover-mode ai --cover-index 2
```

选择推荐封面后会核对当前预览与候选图片来源，支持从 CSS 背景图读取候选。如果旧封面没有变成所选图片，返回 `cover_confirmation_required`，不投稿或暂存。

## 上传图片封面

`bilibili-creator/cover-select --cover ./cover.png --cover-mode upload` 将同一张
JPG/PNG 应用到新上传视频的 4:3、16:9 两种裁剪。两个“双比例同步改动”开关必须
已开启，否则在传文件前拒绝。适配器会检查两张画布和已加载的预览均变化，再确认
共用编辑器、核对表单新封面。不投稿、不暂存、不修改已有作品。上传需要 CLI 的
`file.elementRelayUpload` 能力，已发布的 1.5.265 尚不具备。

不传文件时默认 `review`，返回 `cover_selection_required` 和当前是否有封面，
不打开编辑器。这里只支持 upload/review；已有推荐候选仍由 `video-publish`
选择。AI 生成、任意视频帧和改已有作品封面尚未实现。返回
`cover_confirmation_required` 时，表单可能已附上图片，请先检查再重试。传入文件
不能选择 review 模式。

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

## 平台 AI 候选

`bilibili-creator/cover-ai` 默认只读取候选、真实界面标签和 `candidate_token`，
不默认选第一张。`--generate true` 明确点一次“AI生成”并等待可观察结果。平台提示
生成失败时返回 `ai_generation_failed`；留下的系统推荐帧不会被当作 AI 生成成功。
已有失败状态不自动重试，结果不明时返回 `retryable: false`。

先用 `screenshot --selector .cover-ai` 查看候选，再明确传
`--cover-index 2 --candidate-token <返回的token>` 选择。token 绑定当前图片来源与
界面标签，变化后需重新核对。不能在同一个请求中生成后自动按旧下标选择。只有表单
实际封面与目标图片相符，才返回 `candidate_selected`；投稿前仍需核对两个裁剪比例，
结果会标记 `requires_crop_review: true`。这个命令不投稿、不存草稿。

实页测试视频触发的 AI 生成返回失败。初次候选选择因 URL 核验未通过而停止；之后只读检查确认第 2 张候选已选中，主封面也变成编码图片。修正后的核验通过样本回归，没有在真实账号整条重跑；生成成功分支同样不能当作实页生成成功的证明。

`video-publish` 会在操作表单前拒绝尚未接入的封面文件／截帧参数。请先用 `cover-select`，检查预览后再明确传 `--cover-mode keep` 投稿。`--cover` 与 keep 同时出现时不会静默忽略文件。
