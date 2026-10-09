# `xiaohongshu/` — 在小红书主站读自己的主页数据

[English](README.md) · 中文

官方包里只有一个 adapter：`xiaohongshu/me`。它在 `www.xiaohongshu.com` 上读当前登录用户的主页数据（关注 / 粉丝 / 获赞与收藏、IP 属地，可选带上最新几篇笔记），不需要再单独登录创作服务平台。只读。需要先在 chrome-use 控制的浏览器里扫码登录 `www.xiaohongshu.com`。

其他 `xiaohongshu/*` 命令来自社区包 [`epiral/bb-sites`](https://github.com/epiral/bb-sites)。这里的 `me` 会覆盖社区版的 `xiaohongshu/me`（社区版没有关注 / 粉丝等数字）：官方包最后同步，同名时以官方为准。社区版原有的字段名保持不变。要看自己创作平台里的数据（笔记列表、笔记数据），用 [`xiaohongshu-creator/`](../xiaohongshu-creator/README.zh.md)。

## 命令

```sh
chrome-use site xiaohongshu/me
chrome-use site xiaohongshu/me --notes 10     # 同时带上最新的笔记（最多 30 篇）
```

## Adapter 一览

| adapter | 参数 | 返回 / 作用 |
| --- | --- | --- |
| `xiaohongshu/me` | `[--notes N]`（默认 0，最多 30，即主页首屏加载的数量） | `userid`、`nickname`、`red_id`、`desc`、`gender`、`ip_location`（IP 属地）、`follows`、`fans`、`likes_and_collects`（获赞与收藏，小红书只显示合计）、`url`。加 `--notes` 时多一个 `notes` 列表，每篇：`note_id`、`title`、`type`、`likes`、`sticky`、`url`（带 `xsec_token`）。当前用户取自页面的 Pinia user store；各项数字来自对主页的一次 GET，从服务端渲染的 `window.__INITIAL_STATE__` 里解析。 |

## 安全与测试

- 每次只发一个请求（主页本身），不调接口、不翻页：小红书会因为脚本流量封号。
- 不要循环或轮询。需要真机验证时只跑一次。
- 没登录时返回 `{error: "Not logged in", hint}`，打开 `https://www.xiaohongshu.com` 扫码登录即可。

## 测试

`node --test xiaohongshu/`

改动记录见 [CHANGELOG](../CHANGELOG.md)。
