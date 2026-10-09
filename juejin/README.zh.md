# `juejin/` — 把 Markdown 文章发到掘金

[English](README.md) · 中文

`juejin/article-publish` 以当前登录的账号把一篇 Markdown 文章发到 [掘金 juejin.cn](https://juejin.cn)。它先建草稿再发布；加 `--draft true` 则只建草稿。写的是你的真实账号。chrome-use 驱动的那个浏览器里要先登录 juejin.cn，没登录会在写入前就停下。

## 命令

```sh
# 只存草稿（建议先这样试）
chrome-use site juejin/article-publish --title "标题" --markdown @post.md \
  --summary "一段摘要，50 到 100 个字" \
  --tags "Claude,AI编程,开源" --category 人工智能 --draft true

# 建草稿并发布
chrome-use site juejin/article-publish --title "标题" --markdown @post.md \
  --summary "一段摘要，50 到 100 个字" \
  --tags "Claude,AI编程,开源" --category 人工智能
```

`--markdown` 是整篇正文的字符串，用 `@post.md` 传文件，`@-` 读标准输入。chrome-use 1.5.149 之前的版本要写成 `--markdown "$(cat post.md)"`。

## Adapter 一览

| adapter | 参数 | 返回 / 做什么 |
| --- | --- | --- |
| `juejin/article-publish` | `--title`（必填）、`--markdown`（必填）、`--summary`、`--tags`、`--category`、`--draft` | 先调 `api.juejin.cn` 的 `content_api/v1/article_draft/create` 建草稿（Markdown 放在 `mark_content`，`edit_type` 10），再用 `content_api/v1/article/publish` 发布。返回 `{ok, id, draft_id, url, status, tags, skipped_tags}` 或 `{error, hint}`。 |

- **分类**：`--category` 填编辑器里显示的名字（后端 前端 Android iOS 人工智能 开发工具 代码人生 阅读），或者数字分类 id。名字通过 `tag_api/v1/query_category_list` 查；查不到会报错并列出可用的名字。发布必须有分类，只存草稿可以不填。
- **标签**：逗号分隔（`,` 或 `，`）。每个名字用 `tag_api/v1/query_tag_list` 搜，只认完全同名的，其次是忽略大小写同名的，不会拿搜索结果里相近的标签顶替。最多用 3 个；多出来的和掘金没有的都放进 `skipped_tags`。发布至少要有一个已存在的标签。
- **摘要**：作为 `brief_content` 提交，截到 100 个字。摘要不在 50 到 100 字之间，掘金会拒绝发布。不传 `--summary` 时取正文前 100 个字（去掉代码块、图片和 Markdown 标记）。
- **写入前的检查**：缺标题或正文、没登录、分类不存在，以及发布时没有分类或没有一个已存在的标签，都会在建草稿之前就停下。
- **返回结果**：`--draft true` 时 `status` 是 `"draft"`，`id` 是草稿 id，`url` 是 `https://juejin.cn/editor/drafts/<id>`。发布后 `status` 是 `"published"`，`id` 是文章 id，`url` 是 `https://juejin.cn/post/<id>`。新文章要过掘金审核才公开。
- **草稿存了但发布失败**：结果里有 `error`、`status: "draft"` 和草稿链接。不要重跑，重跑会再建一份草稿；去掘金编辑器里手动发。

跑一次就是一篇文章。重发同一篇之前先看一眼自己的文章列表，测试用的草稿记得删掉。

## 测试

`node --test juejin/`

测试跑在模拟的 `api.juejin.cn` 上，不会请求线上。

同一个 adapter 还有：[csdn](../csdn/) · [segmentfault](../segmentfault/) · [zhihu](../zhihu/)
变更记录见 [CHANGELOG](../CHANGELOG.md)。
