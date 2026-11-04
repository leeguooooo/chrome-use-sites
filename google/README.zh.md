# `google/` — Google 网页搜索

[English](README.md) · 中文

一个只读适配器，用于 [Google](https://www.google.com) 搜索。不需要登录。chrome-use 在 `www.google.com` 标签页里运行它。

它替换社区包（[epiral/bb-sites](https://github.com/epiral/bb-sites)）里的 `google/search`，chrome-use 现在改用这里的版本。社区版解析不到结果时直接返回 `{"count": 0}`，不报错；结果链接原样返回 Google 的相对地址 `/goto?url=…`，调用方既拿不到目标地址，也拿不到域名。

## 命令

```sh
chrome-use site google/search "chrome-use"
chrome-use site google/search "chrome-use" --count 25 --json   # 会读 ?start=10、?start=20
```

## 适配器

| 适配器 | 参数 | 返回 / 行为 |
| --- | --- | --- |
| `google/search` | `<query>` `[--count N]`（默认 10，范围 1–50） | 读 Google 同源结果页（`/search?q=`，每页 10 条）。返回 `{ query, count, pages_read, results }`，每条结果有 `title, url, domain, display_url, redirect, snippet`。 |

- `url` 都是绝对地址。直接链接原样返回，`/url?q=` 会解开，Google 的 `/goto?url=<token>` 跳转转成 `https://www.google.com/goto?url=<token>`，并标 `redirect: true`。token 不是目标地址，页面也读不到跨域跳转，所以要看去向请用 `domain` / `display_url`，或在浏览器里打开 `url`。
- `domain` 是链接的主机名；跳转链接则取 Google 在标题下显示的地址（`display_url`，例如 `https://github.com › user › repo`）。

### 限制

- 结果页解析不出任何结果时返回**错误**和提示（在标签页里打开这次搜索再读），不会静默返回 `count: 0`。如果标签页已经停在同一个查询的结果页，会先读渲染后的页面。
- 浏览器配置从没打开过 Google 结果页时，Google 会对适配器的后台请求返回脚本检查页。这时适配器会在标签页里打开结果页，并返回带 `retry: true` 的错误；再跑一次同样的命令即可。
- Google 明确说没有匹配结果时返回 `{ count: 0, results: [], no_results: true }`。目前识别英文、中文、日文和韩文的提示。
- 遇到验证码（`/sorry/`、HTTP 429）返回错误；在标签页里过完验证再重试。
- 第一页之后每页之间等 0.4–1 秒。

## 测试

`node --test google/` 用 `fixtures/` 里的页面、打桩的 `fetch` 和 `douyin-creator/fakedom.mjs` 的简易 DOM 跑适配器。
