# `csdn/` — 把 Markdown 文章发到 CSDN

[English](README.md) · 中文

`csdn/article-publish` 以当前登录的账号把一篇 Markdown 文章发到 CSDN，类型是原创、全部可见。它在 `editor.csdn.net` 上运行，一次请求保存文章：直接发布，或者加 `--draft true` 只存草稿。写的是你的真实账号。chrome-use 驱动的那个浏览器里要先登录 CSDN（passport.csdn.net），没登录会在保存前停下。

## 命令

```sh
# 只存草稿（建议先这样试）
chrome-use site csdn/article-publish --title "标题" --markdown @post.md \
  --summary "一段摘要" --tags "Claude,AI编程,人工智能,开源" --draft true

# 发布
chrome-use site csdn/article-publish --title "标题" --markdown @post.md \
  --summary "一段摘要" --tags "Claude,AI编程,人工智能,开源"

# 覆盖一篇已有的文章（比如编辑器自动保存的草稿）并发布，不新建
chrome-use site csdn/article-publish --id 123456789 --title "标题" --markdown @post.md --tags "AI编程"
```

`--markdown` 是整篇正文的字符串，用 `@post.md` 传文件，`@-` 读标准输入。chrome-use 1.5.149 之前的版本要写成 `--markdown "$(cat post.md)"`。

## Adapter 一览

| adapter | 参数 | 返回 / 做什么 |
| --- | --- | --- |
| `csdn/article-publish` | `--title`（必填）、`--markdown`（必填）、`--summary`、`--tags`、`--category`、`--html`、`--id`、`--draft` | 一次 `POST bizapi.csdn.net/blog-console-api/v3/mdeditor/saveArticle`，带 `markdowncontent`、渲染好的 HTML、`type: original`、`readType: public`，`status` 为 0（发布）或 2（草稿）。返回 `{ok, id, url, status, tags, skipped_tags}` 或 `{error, hint}`。 |

- **请求签名**：`bizapi.csdn.net` 的每个请求都要带 x-ca-* 签名头。adapter 不自己算，而是从页面打包代码里找到编辑器自己的请求客户端，借它发请求。chrome-use 打开的是 `https://editor.csdn.net/`，这一页不是编辑器，所以 adapter 会在一个隐藏的同源 iframe 里加载 `editor.csdn.net/md/`，拿到客户端，用完把 iframe 删掉。CSDN 改了打包代码、找不到客户端时，会报错说明 adapter 需要更新。
- **标题**：CSDN 要求 5 到 100 个字，adapter 不检查。
- **摘要**：填进摘要（`Description`）字段，截到 256 个字。不传就留空。
- **标签**：逗号分隔。每个名字用 CSDN 的标签搜索去查，只认完全同名的，其次是忽略大小写同名的。最多用 5 个。博客等级不到 3 级的账号不能新建标签，CSDN 没有的名字都放进 `skipped_tags`。发布至少要有一个已存在的标签，一个都没有就在保存前停下。
- **分类专栏**：`--category` 填你自己的分类专栏名，逗号分隔，可不填。
- **正文 HTML**：adapter 自己把 Markdown 转成 HTML（标题、段落、代码块、引用、嵌套列表、分割线、GFM 表格、粗体/斜体/删除线、行内代码、链接、图片；原文里的 HTML 会被转义）。传 `--html` 就用你给的 HTML。
- **`--id`**：保存到这篇已有的文章上（发布；加 `--draft true` 则存为草稿），不新建。
- **返回结果**：草稿时 `status` 是 `"draft"`，`url` 是 `https://editor.csdn.net/md/?articleId=<id>`。发布后 `status` 是 `"published"`，`url` 是 CSDN 返回的博客地址（没有时为 `https://blog.csdn.net/<用户名>/article/details/<id>`）。CSDN 会审核新文章，可能要过几分钟才能看到。
- **保存被拒**：结果里有 `error`、`tags` 和 `skipped_tags`。重跑之前先去 https://mp.csdn.net/mp_blog/manage/article 看一下。

跑一次就是一篇文章。测试用的草稿记得删掉。

## 测试

`node --test csdn/`

测试用的是模拟的编辑器客户端，另外会检查 Markdown 转换代码和 `zhihu/` 里的是否一致。

同一个 adapter 还有：[juejin](../juejin/) · [segmentfault](../segmentfault/) · [zhihu](../zhihu/)
变更记录见 [CHANGELOG](../CHANGELOG.md)。
