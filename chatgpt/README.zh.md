# `chatgpt/` — 把你自己的 ChatGPT 账号读成结构化数据

[English](README.md) · 中文

借用浏览器里现成的会话查询 `chatgpt.com`：当前登录的是哪个账号、会话列表和单个会话的消息、项目、可用模型，以及某个会话里生成的图片。不需要 `OPENAI_API_KEY`：adapter 从页面自己的 `/api/auth/session` 读 bearer token，不产生 API 费用，看到的和你在网页上看到的完全一样。除了 `chatgpt/open-project` 会让标签页跳转（还可能新建项目），其余都只读。chrome-use 驱动的浏览器里必须已登录 `chatgpt.com`。

## 命令

```sh
chrome-use site chatgpt/me
chrome-use site chatgpt/conversations --limit 10
chrome-use site chatgpt/conversations --project g-p-68bf…     # 只看一个项目
chrome-use site chatgpt/conversation 6aa20b3f-c6fc-83e8-9007-e1e3d3a8eb3d
chrome-use site chatgpt/models pro
chrome-use site chatgpt/projects
chrome-use site chatgpt/projects --name "Blog illustrations"   # 精确匹配
chrome-use site chatgpt/open-project --name "Blog illustrations"   # 进入项目（会改页面状态）
chrome-use site chatgpt/images https://chatgpt.com/c/6aa20b3f-…   # 生成的图片和下载链接
```

## Adapter 一览

| adapter | 参数 | 返回 / 作用 |
| --- | --- | --- |
| `chatgpt/me` | — | 这个浏览器登录的是哪个账号。同时读 `/api/auth/session` **和** `/backend-api/me`（后者只靠 cookie，不需要 bearer）。返回 `signed_in, id, email, name, country, region, auth_provider, session_expires, token_available`；会话还在但拿不到 token 时，`token_available` 为 `false`，不会假装一切正常。 |
| `chatgpt/conversations` | `[--limit N] [--offset N] [--project g-p-…]` | `GET /backend-api/conversations?order=updated`，最新的在前。`limit` 限制在 1–100（默认 20）。`--project` 在本地按 `gizmo_id` 过滤，因为接口本身不支持按项目筛选。返回 `{ count, offset, project, conversations }`，每项 `id, title, url, created, updated, project, snippet, archived, starred`（`snippet` 是侧边栏里那行预览）。不返回 `total`，原因见注意事项。 |
| `chatgpt/conversation` | `<id\|url> [--limit N] [--all true]` | 从 `/backend-api/conversation/<id>` 读一个会话的消息。可以传 UUID，也可以传 `/c/<id>` 或 `/g/<gizmo>/c/<id>` 链接。只沿**当前分支**走（从 `current_node` 往上找父节点），编辑或重新生成留下的旧分支不会混进来。隐藏消息、推理摘要、空的工具占位默认都去掉，`--all true` 才保留；`--limit` 只留最后 N 条。返回 `id, title, url, created, updated, project, model, archived, starred, read_only, async_status, count, messages, final`；每条消息是 `role, text, content_type, created, end_turn, model`。`end_turn: true` 表示这条消息结束了一轮；`final` 是最后一条结束了本轮且有文字的 assistant 消息。服务器还在处理时 `async_status` 不为 null。 |
| `chatgpt/models` | `[slug] [--efforts true]` | 调 `/backend-api/models`，列出这个账号实际能用的模型。`slug` 按 slug 或标题做不区分大小写的包含匹配（用位置参数传；不叫 `model` 是因为 `--model` 被 chrome-use 占用）。返回 `default, picker_version, count, total, filter, models, categories`。每个模型有 `slug, title, description, max_tokens, reasoning_type, configurable_thinking_effort, thinking_effort_count, tags`，加 `--efforts true` 再带上 `thinking_efforts`（`effort, label, description`）。每个分类有 `category, name, short_name, default_model, subscription_level, tagline`。 |
| `chatgpt/projects` | `[--name <完整名称>]` | 项目在内部是 "snorlax" gizmo，只有 `GET /backend-api/gizmos/snorlax/sidebar?conversations_per_gizmo=0` 能列出来。返回 `{ count, projects }`，每项 `id, name, description, url, updated, default_model`。`--name` 精确匹配、区分大小写；找不到时会告诉你一共有几个项目。 |
| `chatgpt/open-project` | `--name <项目名> \| --id <g-p-…> [--create true]` | **不是只读**：把当前标签页切进某个项目，这样下一个对话从一开始就归在这个项目下。侧边栏有链接时直接原地点击（只花一次后端请求，整页刷新约 45 次），而且只点项目**主页**的链接，不会点到项目里的某个旧会话；没有链接就跳转到 `/g/<id>/project`。按名称查找的规则和 `chatgpt/projects` 一样；只有传 `--create true` 才会新建项目。页面正显示 "Too many requests" 弹窗时直接拒绝。返回 `{ ok, id, name, url, created, opened }`，`opened` 为 `in_place` 或 `navigate`。 |
| `chatgpt/images` | `<id\|url> [--last true] [--uploads true]` | 列出某个会话里 ChatGPT 生成的图片（只看当前分支），每张都带一个签名的 `download_url`，来自 `/backend-api/files/download/<file_id>`（老的 `file-service://` id 走旧接口 `/files/<id>/download`）。脚本没等到图片出来就放弃时，可以用它把结果捞回来，不必再提示一次。`--last true` 只留最新一轮；`--uploads true` 把用户上传的图片也列上。返回 `id, title, url, finished, async_status, count, images`；每张图 `file_id, source, width, height, size_bytes, gen_id, prompt, created, message_id, download_url`（`source` 是 `generated` 或 `uploaded`；另有 `file_name`，拿不到链接时是 `download_error`）。链接会过期，拿到后马上在这个标签页里下载。`finished: false` 且没有图片，说明服务器还在生成，不代表没有图。 |

`chatgpt/images` 在 2026-10-07 通过 `image-use recover` 实测过（从一个 `sediment://` 会话取回 5 张生成的 PNG）；旧的 `file-service://` 回退路径还没验证过。

这些 adapter 共用 `chatgpt/_helper.js`（取 token、发请求、错误归类）。401/403 表示没登录或 token 过期；429 有单独的错误和 `hint`（见下文）。

## 为什么这个 pack 只能发请求，而且必须保持这样

site adapter 是通过 `eval` 执行的页面 JS，产生不了*可信的*点击和按键，而 ChatGPT 的输入框两样都要：

- 页面 JS 里调 `.click()` **打不开**模型选择器，只有真实的坐标点击可以。
- 五档智能等级已经不是菜单项，而是一个 `[role="slider"]`（`aria-valuenow` 0–4），靠方向键调。模型*系列*是另一个维度（`[role="menuitemradio"]`）。

所以"发提示词""生成图片"根本做不成 adapter，需要一个能调用 `chrome-use click` / `chrome-use press` 的 CLI。这两件事分别在 [`chatgpt-use`](https://github.com/leeguooooo/chatgpt-use)（对话）和 [`chatgpt-imagegen`](https://github.com/leeguooooo/chatgpt-imagegen)（图片）里。在这里加一个操作 DOM 的 adapter，表面上能跑，之后出的问题会很难定位。

## 注意事项

- **每个账号只开一个 chatgpt.com 标签页。** 账号下*任何*会话生成完图片，ChatGPT 都会往*每个*打开的 chatgpt.com 标签页推一条 "Image created" 提示。这条提示挂在 `<main>` 之外的 portal 里，缩略图 `src` 又和图片资源的 URL 格式一样，所以在整个 document 里扫 DOM 会悄悄拿到别的会话的图。所有 DOM 读取都要限定在 `main …` 里。两个进程共用一个输入框，提示词还会被拼到一起。
- 因此 `chatgpt-use` 和 `chatgpt-imagegen` 每一轮都要先拿 **`~/.chatgpt-web.lock`** 这把共享的建议锁，并且固定使用名为 **`chatgpt-web`** 的 chrome-use 会话。新写的任何 chatgpt.com 自动化都应该用同一把锁和同一个会话名。
- **`--model` 是 chrome-use 保留的全局 flag**，到不了 adapter。`--state`、`--session`、`--profile`、`--new`、`--window`、`--as` 也一样。这类参数用位置参数传，或者放在 `--` 后面。
- 未登录时返回的是 **HTTP 200 加 `{}`**，不是错误状态码。所以 `chatgpt/me` 会专门检查 token 在不在。
- **HTTP 429 表示账号被限流**，不是请求写错了。页面会弹出 "Too many requests"，之后几分钟都用不了。adapter 会返回一个专门的 `hint` 让你等一等；不要在这上面写重试循环。
- **`/backend-api/conversations` 返回的 `total` 不是全账号的总数。** 实测 `limit=3` 时报 `total: 4`，而侧边栏里有约 28 个会话。按 `offset >= total` 来翻页，翻到第二页就会停，所以 `chatgpt/conversations` 故意不返回它。真正的结束信号是某一页的条数少于 `limit`。
- `/backend-api/me` 里国家字段叫 **`country`**，没有 `geoip_country`。
- snorlax gizmo 上的时间字段是 **`updated_at`**，没有 `update_time`（`update_time` 是会话接口用的）。
- 会话 id 要等**第一轮被保存后**才出现在 URL（`/c/<uuid>`）里，第一轮进行中没有 id 可以重新接上。

## 安全与测试

**不要拿线上 ChatGPT 测这些 adapter。** 不要为了检查 adapter 去跑 `chrome-use site chatgpt/*`，也不要在临时会话里打开 chatgpt.com。它们跑在你自己已登录的浏览器里，chatgpt.com 按**请求次数**限流：整页加载一次约 45 个后端请求，脚本化的实测已经让日常使用的账号触发过 "Too many requests"。

改为离线验证。测试会按 chrome-use 的方式加载每个 adapter（`_helper.js` 在作用域里），配上桩化的 `fetch` 和 `document`；参见 `chatgpt/adapters.test.js` 里的 `loadAdapter` 和 `router`。新行为要在那里补一个带桩的测试。只能在线上确认的部分，在 PR 里写明，标为未验证。

## 测试

`node --test chatgpt/`

变更记录见 [CHANGELOG](../CHANGELOG.md)。
