# `bilibili/` — 用户投稿列表和自己视频的创作中心数据

[English](README.md) · 中文

两个只读 adapter。`user-videos` 从 `api.bilibili.com` 读任意用户的投稿，在 `www.bilibili.com` 标签页里运行。`creator-stats` 读当前登录账号某个视频在创作中心的数据，在 `member.bilibili.com` 标签页里运行。chrome-use 驱动的浏览器里要先登录 bilibili.com。

`bilibili/*` 的其他命令（`me`、`search`、`feed`、`video` 等）来自社区 pack（[epiral/bb-sites](https://github.com/epiral/bb-sites)）；这两个在这里维护，chrome-use 运行这里的文件，不再运行 OpenCLI 的同名命令。投稿发布在 [`bilibili-creator/`](../bilibili-creator/)。

## 命令

```sh
chrome-use site bilibili/user-videos 53579383                 # 最新 20 个
chrome-use site bilibili/user-videos 53579383 --limit 200     # 自动翻页，每页 50
chrome-use site bilibili/user-videos https://space.bilibili.com/53579383 --order click
chrome-use site bilibili/creator-stats BV1xx411c7mD
chrome-use site bilibili/creator-stats https://www.bilibili.com/video/BV1xx411c7mD
```

## Adapter 一览

| adapter | 参数 | 返回 / 作用 |
| --- | --- | --- |
| `bilibili/user-videos` | `<uid>`（UID、`space.bilibili.com/<uid>` 链接，或完整昵称）`[--limit N] [--order pubdate\|click\|stow] [--page N]` | 调 WBI 签名的 `/x/space/wbi/arc/search`。`limit` 默认 20，最多 1000，超过 50 自动翻页。返回 `{ mid, order, total, count, videos }`，每个视频含 `rank, bvid, aid, title, plays, likes, comments, danmaku, length, created, date, url`。只读。 |
| `bilibili/creator-stats` | `<bvid>`（准确的 BV 号或 `https://www.bilibili.com/video/BV…` 链接） | 读创作中心的 `archive_diagnose/compare` 列表（账号最近 100 个视频）。返回 `{ ok, bvid, title, source, values, metrics, missing }`。只读。 |

### `bilibili/user-videos` 说明

- **签名在页面里算。** WBI 签名（`w_rid`：排序后的查询串加上 `/x/web-interface/nav` 给的 mixin key 做 MD5）在标签页里计算，同时带上空间页本身会带的 `dm_img_*` 字段。
- **风控。** 遇到 `-352`（风控）会重新取 key，等 1.5 秒再试一次。还失败就返回错误和提示，已经读到的页一并返回（`partial: true`）。不会循环重试。
- **昵称。** 昵称只在 B 站用户搜索结果里有完全一致的才会采用；否则返回 `candidates`（`mid, uname, fans`），什么都不读，免得读成别人的账号。
- B 站列表里经常不给 `likes`，这时为 `null`：缺的数一律是 `null`，不会填 0。`created` 是 ISO 8601，`date` 是 `YYYY-MM-DD`。

### `bilibili/creator-stats` 说明

- `metrics` 是 `{ metric, value, unit }` 列表，`values` 是同样内容的对象形式。指标：`playCount, likeCount, commentCount, danmakuCount, favoriteCount, coinCount, shareCount, newFollowerCount`（次数），`durationSeconds`（秒），以及 `completionPct, activeFollowerViewPct, thumbnailClickPct, threeSecondExitPct, interactionPct, playToFollowerPct`（百分比；B 站给的是万分比，adapter 除以 100）。
- B 站没给的指标为 `null`，并列在 `missing` 里；别的视频那一行格式不对会被跳过。两种情况都不会让命令失败。
- 正常情况下 `source: "creator_center"`。不在最近 100 个里的视频，退回 `/x/web-interface/view` 的公开数据（`source: "public"`，附 `owner` 和 `note`）：各项次数有值，涨粉和各类比率为 `null`。
- 错误：`not_logged_in`、`no_stats_yet`（B 站还没生成这个视频的分析）、`not_found`；参数不对时在发请求前就拒绝。

## 来源和许可证

两个文件都移植自 [OpenCLI](https://github.com/jackwener/opencli) v1.8.8（`clis/bilibili/user-videos.js`、`clis/bilibili/creator-stats.js`，以及 `clis/bilibili/utils.js` 里的辅助函数），Copyright 2025 jackwener，按 Apache License 2.0 授权（[LICENSE-OpenCLI](LICENSE-OpenCLI)）。每个文件开头写明了 chrome-use 改了什么。

## 安全 / 测试

它们只读，但读的是真实登录的账号，而且 B 站会限制脚本化的读取：开发时用 stub 测试，真要线上检查只跑一次，不要循环（见 AGENTS.md）。

## 测试

`node --test bilibili/`

改动记录见 [CHANGELOG](../CHANGELOG.md)。
