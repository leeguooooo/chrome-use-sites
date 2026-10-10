# `twitter/` — X 搜索、对话串、个人资料和发推

[English](README.md) · 中文

这些 adapter 在你已登录的 `x.com` 标签页里直接调用 X 自己的 GraphQL 接口。`search`、`thread`、`user` 只读；`post` 会写入，用当前登录的账号发推或回复；`delete` 删除该账号的一条推文。chrome-use 驱动的那个浏览器里必须先登录 `x.com`（adapter 要用 `ct0` cookie）。

`search` 和 `thread` 返回的每条推文字段一致：`likes`、`retweets`、`replies`、`bookmarks`，以及数值型的 `views`。X 不给或限制某项数据时，该字段为 `null`。

## 命令

```sh
chrome-use site twitter/search "chrome-use" --count 20
chrome-use site twitter/search "chrome-use" --type top
chrome-use site twitter/thread 2048506314163458106
chrome-use site twitter/user                 # 当前登录的账号
chrome-use site twitter/user leeguooooo

chrome-use site twitter/post --text @tweet.txt --dry_run true
chrome-use site twitter/post --text @tweet.txt
chrome-use site twitter/post --text @second.txt --reply_to https://x.com/you/status/123
chrome-use site twitter/post --text @tweet.txt --media ./clip.mp4 --timeout 5m   # 原生视频
chrome-use site twitter/delete https://x.com/you/status/123 --until-done
```

## Adapter 一览

| adapter | 参数 | 返回 / 作用 |
| --- | --- | --- |
| `twitter/search` | `<query> [--count N] [--type latest\|top]` | 调 `SearchTimeline`。`count` 默认 20，最多 50；`type` 默认 `latest`。返回 `{ query, product, count, tweets }`，每条推文含 `id, author, name, url, text, likes, retweets, replies, bookmarks, views, in_reply_to, created_at`。 |
| `twitter/thread` | `<tweet_id>`（数字 id 或推文链接） | 调 `TweetDetail`，取主推文和回复，顺着游标最多翻 5 页。返回 `{ tweet_id, count, tweets }`，每条推文含 `id, author, text, url, likes, retweets, replies, bookmarks, views, in_reply_to, created_at`。 |
| `twitter/user` | `[screen_name]`（不带 `@` 的用户名，也可以传主页链接） | 调 `UserByScreenName`。不传用户名时，从侧边栏的 Profile 链接读出当前登录账号。返回 `id, name, screen_name, url, bio, location, website, created_at, followers, following, tweets, media, likes, pinned_tweet_ids, verified`。 |
| `twitter/post` | `--text <文本\|@文件> [--reply_to <id\|链接>] [--media <文件>] [--dry_run true]` | **会写入。** 通过 X 的 `CreateTweet` 发出，带上和网页版一样的 `X-Client-Transaction-Id` 请求头。返回 `{ ok, id, url, weighted_length, in_reply_to, media }`。`--dry_run true` 只返回 `{ ok, dry_run, weighted_length, variables, media }`，什么都不发。 |
| `twitter/delete` | `<tweet>`（推文链接或数字 id） | **会删除。** 像人一样打开推文、点 ⋯ 菜单里的删除并确认。返回 `{ ok, status: "deleted", id }`。请加 `--until-done`：不在该推文页面时，第一次运行返回 `status: "navigating"` 并打开推文，重跑时才删除。 |

### `twitter/user` 说明

`UserByScreenName` 的两种返回结构都能读：2026 年的新结构把计数从 `legacy` 挪到了 `relationship_counts` / `tweet_counts` / `action_counts`，旧结构仍在 `legacy` 里。`website` 优先取展开后的网址，X 不给时就是 t.co 短链。它覆盖了社区版的 `twitter/user`，后者在 X 挪走计数后就拿不到数了。

### `twitter/post` 说明

- **发送前先查长度。** 按 X 的算法计权重：中日韩字符（以及拉丁字母和常用标点之外的字符，比如 emoji）算 2，每个链接算 23，上限 280。超了就返回错误并附上 `weighted_length`，不会发出去。文字太长就拆开，后面的部分用 `--reply_to` 回复第一条，串推就是这样发的。
- **`--media`** 附带一个本地视频（mp4/mov）或图片，按网页版的方式上传：分块 `INIT` / `APPEND` / `FINALIZE`，视频还要等 X 处理完（最多等 4 分钟）。上传或处理任一步失败都会返回错误，推文不会发出。大视频加 `--timeout 5m`。需要 chrome-use 1.5.149 及以上。
- **结果判断。** X 拒绝发推（重复内容、自动化检测、queryId 过期等）时，错误信息会说明没有发出。如果 X 返回了但没有推文 id，结果里是 `outcome: "unknown"`，先去主页看一眼再决定要不要重发。

#### `twitter/delete` 说明

- 只操作自身状态链接就是这条推文的那个 `<article>`，同页的引用推文或被回复的推文不会被删。菜单里的列表那一行（Add/remove from Lists / 列表）从不点击；英文和中文界面都可用。
- 出错时什么都不删：`tweet_not_found`（推文页上没有它：已删除或不可见）、`menu_not_found`、`not_own_tweet`（菜单里没有删除）、`confirm_not_shown`。
- 移植自 [OpenCLI](https://github.com/jackwener/opencli) v1.8.8 的 `clis/twitter/delete.js` 和 `clis/twitter/shared.js` 里的辅助函数，Copyright 2025 jackwener，Apache License 2.0（[LICENSE-OpenCLI](LICENSE-OpenCLI)）；文件开头写明了 chrome-use 的修改。chrome-use 运行这个文件，不再用 OpenCLI 的 `twitter/delete`。

## 依赖

这些 adapter 调用的 `findGraphQLQueryId` / `findTransactionIdGenerator` 定义在社区仓库 [epiral/bb-sites](https://github.com/epiral/bb-sites) 的 `twitter/_helper.js` 里，不在本仓库。`install.sh` 会按固定 commit 拉取它。

## 安全与测试

这些 adapter 用的是你真实的 X 账号，验证改动优先跑带桩的测试，少做实际调用（见 AGENTS.md）。`twitter/post --dry_run true` 只检查文本、返回将要发送的内容，不会真的发出。

## 测试

`node --test twitter/`

变更记录见 [CHANGELOG](../CHANGELOG.md)。
