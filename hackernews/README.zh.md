# `hackernews/` — Hacker News 首页热门和评论串

[English](README.md) · 中文

两个只读 adapter，读 [Hacker News](https://news.ycombinator.com)。不需要登录。chrome-use 在 `news.ycombinator.com` 标签页里运行它们。

它们取代社区 pack（[epiral/bb-sites](https://github.com/epiral/bb-sites)）里的 `hackernews/top` 和 `hackernews/thread`，chrome-use 现在运行这里的文件。社区版本在页面里调 Firebase API（`hacker-news.firebaseio.com`），但 HN 的响应头是 `Content-Security-Policy: default-src 'self'`，没有 `connect-src`，这个请求会被拦截，所以它们总是报 `TypeError: Failed to fetch`。这里的版本读 HN 自己的同源 HTML（`/news`、`/news?p=2`、`/item?id=`），返回的字段不变。

## 命令

```sh
chrome-use site hackernews/top                 # 前 20 条
chrome-use site hackernews/top 50 --json       # 读 /news 和 /news?p=2
chrome-use site hackernews/thread 50043026
chrome-use site hackernews/thread https://news.ycombinator.com/item?id=50043026 --depth 4
```

## Adapter 一览

| adapter | 参数 | 返回 / 作用 |
| --- | --- | --- |
| `hackernews/top` | `[count]`（默认 20，1 到 50） | 首页（`/news`，每页 30 条）。返回 `{ count, posts }`，每条含 `rank, id, title, url, hn_url, author, score, comments`。自帖（Ask HN）的 `url` 是 `null`。招聘广告没有分数和作者，不返回（计入 `non_story_omitted`）。 |
| `hackernews/thread` | `<id>`（帖子 id 或 `item?id=` 链接）`[--depth N]`（默认 2，0 到 5） | 帖子页（`/item?id=`）。返回 `{ post, comments }`：`post` 含 `id, title, url, hn_url, author, score, comments_count, time, text`；每条评论含 `id, author, text, time, depth, replies`。`text` 是 HTML，和 API 一样；`time` 是 unix 秒。 |

两者都用社区版本原来的 `pinix.site-adapter-result.v1` 外层结构（`__pinix_site_result.metadata`，含 `completeness`、`reason`、`pagination`、`warnings`）。

### 限制

- `top`：`total_available` 是读到的首页条数，不是 HN 完整的 top 500 列表；`more_available` 表示后面还有没有 “More” 链接。
- `thread`：和原来一样，每条评论最多 30 个回复，最多 `depth` 层。已删除、dead、flagged 的评论连同回复一起去掉（`deleted_dead_omitted`）。特别大的评论串 HN 会分页，最多读 5 页（`pages_read`、`more_pages_unread`）。
- 页面内容就是当前登录用户看到的；开了 `showdead` 时 dead 评论也会被识别并去掉。

## 安全 / 测试

只读，公开数据。可以在线验证，但只跑几次。

## 测试

`node --test hackernews/` 用 `fixtures/` 里的页面跑两个 adapter，`fetch` 是桩，除 `news.ycombinator.com` 以外的来源一律拒绝，和 HN 的 CSP 一样。

参见 [CHANGELOG](../CHANGELOG.md)。
