# `douyin/` — 删除或修改自己的抖音作品

[English](README.md) · 中文

两个会写入的 adapter，在你已登录的 `creator.douyin.com` 创作者中心标签页里运行。命令名沿用 [OpenCLI](https://github.com/jackwener/opencli) 的 `douyin/delete` 和 `douyin/update`，chrome-use 以前用 OpenCLI 跑这两个命令；现在由这个 pack 维护，chrome-use 总是运行这里的文件，不再用 OpenCLI 的。要列出作品、查 id，用 [`douyin-creator/works`](../douyin-creator/)。

## 命令

```sh
chrome-use site douyin-creator/works --limit 20          # 先查 id
chrome-use site douyin/delete 7694857245896576275 --until-done
chrome-use site douyin/update 7694857245896576275 --caption @caption.txt
chrome-use site douyin/update 7694857245896576275 --reschedule 2026-10-20T20:00:00+08:00
```

## Adapter 一览

| adapter | 参数 | 返回 / 作用 |
| --- | --- | --- |
| `douyin/delete` | `<aweme_id>` | **会删除。** 在作品管理页（`/creator-micro/content/manage`）先在 `work_list` 里找到这条作品（最多翻 10 页），按标题找到它的卡片，点「删除作品」、确认，再查 `work_list` 直到作品消失。返回 `{ ok, status: "deleted", aweme_id, item_id, title }`。请加 `--until-done`：不在作品管理页时，第一次运行返回 `status: "navigating"` 并打开该页，重跑时才删除。 |
| `douyin/update` | `<aweme_id> [--reschedule <时间>] [--caption <文本>]` | **会写入。** `--reschedule` 通过 `update/timer` 修改定时作品的发布时间（ISO 8601 或 Unix 秒，须在 2 小时到 14 天之后）；`--caption` 通过 `update/desc` 替换正文。返回 `{ ok, status: "updated", aweme_id, updated, publish_time }`。 |

### 说明

- **id 保持精确。** 抖音把 `item_id` 这类 64 位 id 作为裸 JSON 数字发出，`JSON.parse` 会把它取整（`7694857245896576275` 变成 `7694857245896576000`，和相邻 id 一样）。两个 adapter 解析响应时把超过 2^53 的整数保留为精确字符串，按字符串比较，也按字符串发送。
- **按标题找卡片，不按位置。** `douyin/delete` 只点显示该作品标题（`item_title`，或正文第一行）的卡片；有多张时取 markup 里带这个 id 的那张；卡片比 `work_list` 少就滚动加载更多。找不到就返回 `card_not_found`，什么都不点。（OpenCLI 按作品在 `work_list` 里的位置取卡片，页面渲染的卡片少时会失败，甚至点错卡片；chrome-use#508。）
- **错误**以 `{ error, hint, aweme_id, item_id? }` 返回：`not_found`（账号的作品列表里没有这条：已删除，或不是这个账号的）、`card_not_found`、`delete_button_not_found`、`confirm_button_not_found`、`delete_not_confirmed`（已点确认但作品仍在列表里）、`work_list_*`（列表接口失败）。`douyin/update` 会在 `updated` 里说明两个调用中哪个已经执行。

## 安全 / 测试

这两个 adapter 会改动真实账号，只用桩数据测试：`node --test douyin/`。`fixtures/work_list_bigint.json` 是 `work_list` 的结构，id 是编造的，`item_id` 是裸的 19 位数字。不要拿想保留的作品做线上验证（见 AGENTS.md）。

## 来源与许可证

移植自 OpenCLI v1.8.8（`clis/douyin/delete.js`、`clis/douyin/update.js`、`clis/douyin/_shared/timing.js`），Copyright 2025 jackwener，Apache License 2.0；许可证全文见 [LICENSE-OpenCLI](LICENSE-OpenCLI)。每个文件开头写明了 chrome-use 做了哪些修改。本仓库其余部分是 MIT。

改动见 [CHANGELOG](../CHANGELOG.md)。
