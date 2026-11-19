# `gemini/` — 向 Gemini 提问、读取对话

[English](README.md) · 中文

以浏览器里登录的 Google 账号操作 `gemini.google.com`：发一条提示词并拿到回答、读当前对话、列出最近的对话、打开某一条。chrome-use 在你自己 Chrome 的 `gemini.google.com` 标签页里运行它们。

这四个 adapter 用的是 OpenCLI 里同名命令的名字（`gemini/ask`、`gemini/read`、`gemini/history`、`gemini/detail`），chrome-use 现在运行这里的文件。代码是重新写的，没有移植 OpenCLI 的实现。OpenCLI 的 `gemini/image`、`gemini/models`、`gemini/new`、`gemini/status` 和深度研究相关命令不受影响。

起因见 [chrome-use #904](https://github.com/leeguooooo/chrome-use/issues/904)：页面上弹出模态框（「解锁最适合你的 Gemini」）时，OpenCLI 的 `gemini/ask` 把侧边栏文字（最近几条对话的标题）当成回答返回，退出码还是 0；`read` / `detail` / `history` 也读不到页面。这里的回答只来自回答元素的文字，读不到就报错；遇到模态框会报出它的标题和按钮。

## 命令

```sh
chrome-use site gemini/ask "用一句话总结：……"                         # 接着当前对话问
chrome-use site gemini/ask "一个新问题" --fresh true --timeout 400      # 在新对话里问
chrome-use site gemini/read                                           # 当前对话
chrome-use site gemini/read --last 2
chrome-use site gemini/history --limit 10
chrome-use site gemini/detail "旅行计划" --until-done                  # 按标题、id 或 URL
```

## Adapter 一览

| adapter | 参数 | 返回 / 行为 |
| --- | --- | --- |
| `gemini/ask` | `<prompt> [--fresh true]` | 用真实按键（`args.ui`）把提示词打进输入框，按一次 Enter，等新回答下面出现 Gemini 自己的「已完成」标记，返回 `response`（回答元素的文字）、`conversation_id`、`conversation_url`、`sent: true`、`elapsed_ms`。`--fresh true` 会先点「发起新对话」；不带就接着标签页里打开的那条对话。这是写操作：会以你的身份发一条消息。 |
| `gemini/read` | `[--last N]` | 当前对话：`conversation_id`、`conversation_url`、`generating`、`count`、`total_loaded`、`turns`（`{role: "user" \| "assistant", text}`）。只包含页面已经加载的轮次。 |
| `gemini/history` | `[--limit N]` | 侧边栏里的最近对话：`count`、`loaded`、`conversations`（`{title, id, url}`）。`limit` 默认 20，最多 100。只包含侧边栏已经加载的条目。 |
| `gemini/detail` | `<url \| id \| 标题> [--last N]` | 打开那条对话，返回内容同 `gemini/read`。标题先按完全相同匹配，再按「唯一包含这段文字的标题」匹配；匹配到多条时报错并列出来。第一次运行会跳转并返回 `status: "navigating"`，再跑一次或加 `--until-done`。 |

## 失败时

每种失败都返回 `error` 和 `hint`，命令以非 0 退出。需要知道的几种：

| `status` | 含义 |
| --- | --- |
| `blocked_by_dialog` | 页面上开着一个模态框。结果里带 `dialog: {title, text, buttons}`。什么都没输入、没发送（`ask` 在发送之前）。在页面里点你要的按钮，再跑一次命令。adapter 不会替你点。 |
| `not_sent` | 提示词没发出去：字没打进输入框、Enter 没有发送，或者这次运行的时间不够打完。看一眼标签页之后可以重跑。 |
| `answer_not_read` | 提示词**已经发出**（`sent: true`），但在运行时间结束前没读到完成的回答。`partial` 是回答元素里已有的内容，没有就是 `null`。不要重发，稍后用 `gemini/read` 读回答。 |
| `outcome_unknown` | 按了 Enter，输入框清空了，但没有出现新的一轮。再问之前先用 `gemini/read` 或 `gemini/history` 确认。 |

`ask` 没有声明可重跑的状态，所以 `--until-done` 不会把同一条提示词发两次。

## 容易踩的坑

- **`--new` 和 `--model` 是 chrome-use 的全局参数**，不是 adapter 的参数，传不到 adapter 里。开新对话用 `--fresh true`。这里不能选模型和思考强度，请在页面里选。
- **输入按人的速度打字**，实测大约每秒 7 个字符（99 个字符用了 15 秒）。2000 个字符的提示词要打五分钟左右 Gemini 才开始回答；`--timeout` 不够打字时，`ask` 会在按下第一个键之前拒绝。默认 300 秒。很长的提示词（#904 里那条 17 KB 的）不适合这样发。
- **`ask` 需要空闲的输入框。** 输入框里已经有字，或者上一条回答还在生成，都会在输入前拒绝。
- 提示词里的**换行**按 Shift+Enter 输入，整段仍是一条消息。
- 标题、轮次和回答都按页面渲染的内容读取：对话比 Gemini 已加载的部分长时，只返回已加载的部分（见 `total_loaded`）。

## 安全与测试

- 这些 adapter 以你的身份运行。`ask` 会用你的账号发一条真实消息，另外三个只读。
- 开发时用 `gemini/adapters.test.js` 里的桩页面。实测只在自己的对话里发几条短提示词，不循环，也不点任何你没决定过的模态框按钮。

## 测试

`node --test gemini/`

改动记录见 [CHANGELOG](../CHANGELOG.md)。
