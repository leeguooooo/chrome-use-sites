# `xiaohongshu-creator/` — 读自己的小红书创作服务平台（只读）

[English](README.md) · 中文

以浏览器里登录的账号读取 `creator.xiaohongshu.com`（创作服务平台）：账号数据和数据中心的近 7 / 30 天汇总、笔记管理列表、单篇笔记数据。所有 adapter 都只读。需要先在 chrome-use 控制的浏览器里登录 `creator.xiaohongshu.com`，它和 `www.xiaohongshu.com` 是两套登录，要单独扫一次码。主站的数据见 [`xiaohongshu/`](../xiaohongshu/README.zh.md)。

## 命令

```sh
chrome-use site xiaohongshu-creator/me
chrome-use site xiaohongshu-creator/me --summary false            # 只要账号信息，只发一个请求
chrome-use site xiaohongshu-creator/notes --limit 10 --tab published
chrome-use site xiaohongshu-creator/notes --page 2                # 上一次返回的 next_page
chrome-use site xiaohongshu-creator/note-stats 6abbe0ef000000001203e9c7
chrome-use site xiaohongshu-creator/note-stats "https://www.xiaohongshu.com/explore/6abbe0ef000000001203e9c7"
```

## Adapter 一览

| adapter | 参数 | 返回 / 作用 |
| --- | --- | --- |
| `xiaohongshu-creator/me` | `[--summary false]` | `user_id`、`nickname`、`red_id`、`avatar`、`desc`、`fans`、`follows`、`likes_and_collects`（小红书只公开「获赞与收藏」合计）、`level`、`profile_url`，以及 `data_center` 下的 `last_7_days` / `last_30_days`：`start`、`end`、`impressions`、`views`、`cover_click_rate_pct`、`avg_view_time_sec`、`home_views`、`likes`、`collects`、`comments`、`shares`、`new_fans`、`lost_fans`、`net_new_fans`、`notes_published`。和首页一样同时请求 `GET /api/galaxy/creator/home/personal_info` 与 `/api/galaxy/v2/creator/datacenter/account/base`；`--summary false` 不发第二个（`data_center` 为 `null`）。只有汇总失败时，`data_center` 是 `{error, hint}`，账号信息照常返回。用户 id 取自页面的 Vuex store，不额外发请求。 |
| `xiaohongshu-creator/notes` | `[--limit N] [--page N] [--tab T]` | 笔记管理页的 `GET /api/galaxy/v2/creator/note/user/posted?tab=&page=`。`limit` 默认 20，最多 50；服务端每页 10 条，所以每 10 条一个请求。`page` 是游标（默认 0）。`tab`：`all`（默认）、`published`、`reviewing`、`rejected`、`scheduled`，也可以写 全部/已发布/审核中/未通过/定时发布。返回 `tab`、`count`、`total`（标签旁显示的数）、`page`、`next_page`（没有下一页时为 `null`）、`partial`（后面某页失败或超时才有值）和 `notes`。每条笔记：`id`、`title`、`type`（`normal`/`video`）、`published_at`（+08:00）、`status` / `status_text` / `status_code`、`visibility` / `visibility_text` / `visibility_code`、`pinned`、`scheduled_at`、`video_duration`、`cover`、`url`（带笔记管理页给的 `xsec_token`）、`xsec_token`、`views`、`likes`、`collects`、`comments`、`shares`。 |
| `xiaohongshu-creator/note-stats` | `<note_id> [--audience false]` | 笔记数据页的 `GET /api/galaxy/creator/datacenter/note/base`、`…/note/audience/source`、`…/note/audience/source/detail`。`note_id` 可以是 24 位十六进制 id，也可以是 `www.xiaohongshu.com/explore/<id>` 链接。返回 `note_id`、`type`、`desc`、`published_at`、`days_since_post`、`data_updated_at`、`cover`、`url`、`topics`，以及 `metrics`：`impressions`、`views`、`cover_click_rate_pct`、`avg_view_time_sec`、`likes`、`collects`、`comments`、`shares`、`follows_gained`、`danmaku`、`interaction_rate_pct`；图文笔记多一个 `avg_images_viewed`，视频多 `full_view_rate_pct`、`finish_5s_rate_pct`、`exit_2s_rate_pct`、`play_60s_count`。`traffic_sources`（`{available, reason, sources}`）和 `audience`（`{available, reason, gender, age, city, interest}`）都是 `{name, pct}` 列表；`--audience false` 省掉这两个请求。只能查本账号发的笔记。 |

状态码（按创作平台前端代码里的定义）：

| `status_code` | `status` | 页面显示 |
| --- | --- | --- |
| 1 | `published` | 已发布 |
| 2 | `reviewing` | 审核中 |
| 3 | `rejected` | 未通过 |
| 4 | `scheduled` | 定时发布 |

可见范围：

| `visibility_code` | `visibility` | 页面显示 |
| --- | --- | --- |
| 0 | `public` | 公开可见 |
| 1 | `private` | 仅自己可见 |
| 2 | `partially_hidden` | 部分人不可见 |
| 3 | `partially_visible` | 部分人可见 |
| 4 | `friends_only` | 仅互关好友可见 |

**怎么调接口。** 创作平台的每个请求都带 `X-s` / `X-t` / `X-S-Common` 签名头，由页面自己的 HTTP client 计算（内部调 `window._webmsxyw`）。adapter 通过 webpack 模块表找到这个 client（靠模块里写死的接口 key 定位），直接用它发请求，所以请求的构造、签名和发送都和你手动点页面时一样。这里没有直接 fetch，也没有自己实现签名；哪个 adapter 这么做，测试会失败。

**容易踩的坑**

- **缺的指标是 `null`，不是 0。** 数据中心用 `-1` 表示「还没算出来」，发布不到一天的笔记曝光、观看时长和大部分比率都是 `-1`。图文笔记的视频类比率返回 `0`，意思是「不适用」，也统一成 `null`。
- **流量来源和观众画像要有足够观众。** 不够门槛时（页面上一处写 50 人，一处写 100 人）返回 `available: false` 和 `reason`，比如 `"观看数不足100，暂时无法分析"`。
- **`notes` 的游标是页码，不是偏移量。** `limit` 把某一页截断时，`next_page` 会指回那一页，续翻时会重复几条而不是漏掉，按 `id` 去重即可。
- **chrome-use 给每个 adapter 大约 8 秒。** adapter 按 7 秒预算执行：慢请求返回 `"did not answer … in time"`；`notes` 会把已拿到的页返回，同时设置 `partial` 和续翻游标。重试一次就好，不要循环。
- 笔记上的 `tab_status` 和查询参数 `tab` 编号不一样（「全部」是 tab 0，没有对应状态），不要混用。
- 笔记管理页的 `time` 是不带时区的北京时间 `YYYY-MM-DD HH:mm`，`published_at` 补了 `+08:00`。`note-stats` 用的是毫秒时间戳 `postTime`，所以带秒。

## 安全与测试

- 这些 adapter 以你的身份访问真实账号。都是只读（从不调页面 client 的 `post`），请求量也小：`me` 2 个，`notes` 每 10 条 1 个，`note-stats` 3 个，和你打开对应页面时发的请求一样。
- 小红书会因为脚本行为封号。不要循环、轮询，也不要定时把所有笔记翻一遍。
- 真机验证**每个 adapter 只跑一次、只读一页、不循环**。平时开发用 `xiaohongshu-creator/fixtures/` 和打桩测试。
- 返回 HTTP 461 或 429 说明小红书要验证码或在限流：停下来，手动打开创作平台处理。401 或 code -101 说明登录失效，重新登录。

## 测试

`node --test xiaohongshu-creator/`

改动记录见 [CHANGELOG](../CHANGELOG.md)。
