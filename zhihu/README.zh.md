# `zhihu/` — 把 Markdown 文章发到知乎专栏

[English](README.md) · 中文

`zhihu/article-publish` 以当前登录的账号把一篇 Markdown 文章发成知乎专栏文章（`zhuanlan.zhihu.com`）。它先建草稿、绑定话题，再发布；加 `--draft true` 则停在草稿。写的是你的真实账号。chrome-use 驱动的那个浏览器里要先登录 zhihu.com，没登录会在写入前就停下。

## 命令

```sh
# 只存草稿（建议先这样试）
chrome-use site zhihu/article-publish --title "标题" --markdown @post.md \
  --tags "Claude,AI编程,开源" --draft true

# 建草稿并发布
chrome-use site zhihu/article-publish --title "标题" --markdown @post.md \
  --tags "Claude,AI编程,开源"

# 直接给 HTML，不转换 Markdown
chrome-use site zhihu/article-publish --title "标题" --html @post.html --tags "开源"
```

`--markdown` 是整篇正文的字符串，用 `@post.md` 传文件，`@-` 读标准输入。chrome-use 1.5.149 之前的版本要写成 `--markdown "$(cat post.md)"`。

## Adapter 一览

| adapter | 参数 | 返回 / 做什么 |
| --- | --- | --- |
| `zhihu/article-publish` | `--title`（必填）、`--markdown`（必填，给了 `--html` 时可省）、`--tags`、`--html`、`--draft`、`--summary`（忽略） | 先 `POST zhuanlan.zhihu.com/api/articles/drafts` 建草稿，再 `PATCH …/articles/<id>/draft` 把正文写一遍，用 `POST …/articles/<id>/topics` 逐个绑话题，最后 `POST www.zhihu.com/api/v4/content/publish`（`action: "article"`）发布。返回 `{ok, id, url, status, tags, skipped_tags}` 或 `{error, hint}`。 |

- **请求方式**：所有请求都走知乎自己的 fetch 封装（从页面打包代码里找到），由它加上 xsrf token 和 x-zse 签名头。知乎改了打包代码、找不到这个封装时，会报错说明 adapter 需要更新。
- **正文**：adapter 把 Markdown 转成知乎用的 HTML。知乎文章只支持 h2/h3，所以 `#` 变成 h2，`####` 到 `######` 变成 h3；代码块变成 `<pre lang="…">`，和编辑器自己生成的一样。段落、引用、嵌套列表、分割线、GFM 表格、粗体/斜体/删除线、行内代码、链接、图片也都会转换；原文里的 HTML 会被转义。传 `--html` 就直接用你给的 HTML，不做转换。`--summary` 能传但不起作用（知乎从正文生成摘要），留着它是为了同一行命令能在各平台通用。
- **话题**：`--tags` 填话题名，逗号分隔。每个名字用编辑器的话题联想（`autocomplete/topics`）去查，只认完全同名的，其次是忽略大小写同名的。最多绑 3 个，其余放进 `skipped_tags`；知乎拒绝绑定的话题也会连同错误信息列在那里。发布至少要有一个已存在的话题：一个都查不到就在建草稿前停下；查到了但一个都没绑上，会停下并保留草稿。
- **返回结果**：草稿时 `status` 是 `"draft"`，`url` 是 `https://zhuanlan.zhihu.com/p/<id>/edit`。发布后 `status` 是 `"published"`，`url` 是知乎返回的文章地址（没有时为 `https://zhuanlan.zhihu.com/p/<id>`）。
- **账号验证**：发布时返回错误码 4031，说明知乎要求先做手机或实名验证。手动做完，再到草稿的编辑页发布。adapter 不会绕过这类验证。
- **草稿存了但发布失败**：结果里有 `error`、`status: "draft"` 和草稿链接。不要重跑，重跑会再建一份草稿；去知乎编辑器里手动发。

跑一次就是一篇文章。测试用的草稿记得删掉。

## 测试

`node --test zhihu/`

测试用的是模拟的页面和 fetch 封装，不会请求线上。

同一个 adapter 还有：[juejin](../juejin/) · [csdn](../csdn/) · [segmentfault](../segmentfault/)
变更记录见 [CHANGELOG](../CHANGELOG.md)。
