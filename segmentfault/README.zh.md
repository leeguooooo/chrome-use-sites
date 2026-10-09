# `segmentfault/` — 把 Markdown 文章发到思否

[English](README.md) · 中文

`segmentfault/article-publish` 以当前登录的账号把一篇 Markdown 文章发到[思否 segmentfault.com](https://segmentfault.com)。它先存草稿再发布；加 `--draft true` 则只存草稿。写的是你的真实账号。chrome-use 驱动的那个浏览器里要先登录 segmentfault.com，没登录会在写入前就停下。

## 命令

```sh
# 只存草稿（建议先这样试）
chrome-use site segmentfault/article-publish --title "标题" --markdown @post.md \
  --tags "claude,codex,开源" --draft true

# 存草稿并以原创发布
chrome-use site segmentfault/article-publish --title "标题" --markdown @post.md \
  --tags "claude,codex,开源"

# 转载要带原文链接
chrome-use site segmentfault/article-publish --title "标题" --markdown @post.md \
  --tags "claude" --type 转载 --source_url https://example.com/original-post
```

`--markdown` 是整篇正文的字符串，用 `@post.md` 传文件，`@-` 读标准输入。chrome-use 1.5.149 之前的版本要写成 `--markdown "$(cat post.md)"`。

## Adapter 一览

| adapter | 参数 | 返回 / 做什么 |
| --- | --- | --- |
| `segmentfault/article-publish` | `--title`（必填）、`--markdown`（必填）、`--tags`、`--type`、`--source_url`、`--draft`、`--summary`（忽略） | 先 `POST /gateway/draft` 存草稿（字段和 /write 页面自动保存时一样），再带草稿 id `POST /gateway/article` 发布。返回 `{ok, id, draft_id, url, status, message, tags, skipped_tags}` 或 `{error, hint}`。 |

- **请求方式**：segmentfault.com 页面里的网关请求都走同一个 Api 对象（带 token 头，GET 请求还带签名参数）。adapter 从页面打包代码里找到这个对象，直接调它的方法，不自己重做 token 和签名。思否改了打包代码、找不到时，会报错说明 adapter 需要更新。
- **正文**：Markdown 原样提交，由思否渲染。`--summary` 能传但不起作用（思否从正文里生成摘要），留着它是为了同一行命令能在各平台通用。
- **标签**：逗号分隔。每个名字用思否的标签搜索去查，只认完全同名的，其次是忽略大小写同名的。最多用 5 个，其余放进 `skipped_tags`。发布至少要有一个已存在的标签。
- **文章类型**：`--type` 可选 `原创`（默认）、`转载`、`翻译`（也认 `original`、`repost`、`translation` 或 `1`/`2`/`3`）。发布转载或翻译必须带 `--source_url`。
- **写入前的检查**：缺标题或正文、类型不认识、没登录，以及发布时没有已存在的标签、转载/翻译没给 `--source_url`，都会在存草稿之前就停下。
- **返回结果**：草稿时 `status` 是 `"draft"`，`id` 是草稿 id，`url` 是草稿列表 `https://segmentfault.com/user/draft`。发布后 `id` 是文章 id，`url` 是 `https://segmentfault.com/a/<id>`。新账号的文章要人工审核（最长四小时），这时 `status` 是 `in_review`，`message` 里是思否返回的说明；否则 `status` 是 `published`。
- **验证码**：发布时思否如果返回 `scene_id`（要过验证码或其他校验），会停下并返回 `status: "draft"`，草稿保留。去 https://segmentfault.com/write 手动过验证、发布那份草稿，不要重跑命令。
- **草稿存了但发布失败**：结果里有 `error`、`status: "draft"` 和草稿 id。不要重跑，重跑会再存一份草稿；去 https://segmentfault.com/user/draft 手动发。

跑一次就是一篇文章。测试用的草稿记得删掉。

## 测试

`node --test segmentfault/`

测试用的是模拟的 Api 对象，不会请求线上。

同一个 adapter 还有：[juejin](../juejin/) · [csdn](../csdn/) · [zhihu](../zhihu/)
变更记录见 [CHANGELOG](../CHANGELOG.md)。
