# `appstoreconnect/` — App Store Connect 的 App 和构建版本

[English](README.md) · 中文

在你已登录的 [appstoreconnect.apple.com](https://appstoreconnect.apple.com) 标签页里运行，调用的是网页版自己用的 `/iris/v1` JSON:API。`apps` 和 `builds` 只读；`app-create` 会写入，用来新建 App 记录。这一步 App Store Connect API key 做不了（会返回 403），但已登录的网页会话可以。chrome-use 驱动的浏览器里必须已登录 `appstoreconnect.apple.com`，并且完成了双重认证。

## 命令

```sh
chrome-use site appstoreconnect/apps                                  # 所有 App：名称、bundle id、SKU、Apple ID
chrome-use site appstoreconnect/apps --bundle_id com.example.app      # 只看一个
chrome-use site appstoreconnect/app-create --name "My App" --bundle_id com.example.app --sku example-app --locale zh-Hans
chrome-use site appstoreconnect/builds --bundle_id com.example.app    # 最近上传的构建及处理状态
```

## Adapter 一览

| adapter | 参数 | 返回 / 作用 |
| --- | --- | --- |
| `appstoreconnect/apps` | `[--bundle_id]` | 列出账号下的 App（最多 200 个），传了 bundle id 就只看那一个。返回 `{ count, apps }`，每项 `id, name, bundle_id, sku, primary_locale, url`（`id` 就是 Apple ID，`url` 是这个 App 在 App Store Connect 里的页面）。 |
| `appstoreconnect/app-create` | `--name --bundle_id --sku [--locale] [--platform] [--version]` | **会写入。** 和网页上"新建 App"对话框一样，用一个复合请求建出 App 记录（App 本身、带本地化信息的首个版本、带名称的 App 信息）。`name` 不超过 30 个字符，且在整个商店里唯一；`locale` 默认 `en-US`（如 `zh-Hans`、`ja`、`en-GB`）；`platform` 可选 `IOS`（默认）、`MAC_OS`、`TV_OS`、`VISION_OS`；`version` 默认 `1.0`。返回 `{ ok, created, id, name, bundle_id, sku, url }`。 |
| `appstoreconnect/builds` | `--bundle_id [--limit]` | 某个 App 最近的构建版本，最新的在前，用来看上传的包什么时候能进 TestFlight。`limit` 默认 10，最多 50。返回 `{ app_id, count, builds }`，每项 `id, build, state, uploaded, expired, min_os`（`state` 是 Apple 的处理状态）。找不到这个 bundle id 对应的 App 时会直接说明，并提示用 `app-create` 新建。 |

## 说明

- `app-create` 要求 bundle id 已经在开发者后台注册好（这一步 API key 能做）。重复执行是安全的：已有同 bundle id 的 App 时，直接返回它并带 `created: false`，不会再建一个。失败时 `reasons` 里是 Apple 原本的报错，比如名称已被占用。
- 新建 App 需要 Admin 或 App Manager 角色；已登录状态下收到 403，说明这个 Apple ID 可能没有该角色。
- 先登录并完成双重认证，这一步得由人来做（`chrome-use session handoff`）。未登录时返回 `hint: "Not signed in…"`，而不是一个空列表。

## 测试

`node --test appstoreconnect/`

变更记录见 [CHANGELOG](../CHANGELOG.md)。
