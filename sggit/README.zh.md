# `sggit/` — 自建 Gogs（`sg-git.pwtk.cc`）上的 PR 操作

[English](README.md) · 中文

在内部 Gogs `sg-git.pwtk.cc` 上一条命令建 PR、合 PR、列 PR，不用再去 compare 页面点来点去。`pr-list` 只读；`pr-create` 和 `pr-merge` 会写入（提交的是网页上同样的表单）。chrome-use 驱动的浏览器里必须已登录 `sg-git.pwtk.cc`，并且**连着 WARP**。

## 命令

```sh
# 建 PR（三 PR 流程：每个 base 各跑一次）
chrome-use site sggit/pr-create --base dev          --head feat/leo/xxx --title "feat: xxx" --body "..."
chrome-use site sggit/pr-create --base feature-test --head feat/leo/xxx --title "feat: xxx" --body "..."
chrome-use site sggit/pr-create --base main         --head feat/leo/xxx --title "feat: xxx" --body "..."

# 合 PR（我们的流程里 dev 那个直接合）
chrome-use site sggit/pr-merge --pr 134

# 列 PR
chrome-use site sggit/pr-list ka-cn/super-admin closed   # 位置参数
chrome-use site sggit/pr-list --status all               # 或者用 flag
```

所有 adapter 的 `--repo`（`owner/name`）默认都是 `ka-cn/super-admin`。

## Adapter 一览

| adapter | 参数 | 返回 / 作用 |
| --- | --- | --- |
| `sggit/pr-create` | `--base --head --title [--body] [--repo]` | **会写入。** 提交 Gogs 的 compare 表单（`_csrf` + `title` + `content`），302 跳到新 PR。返回 `{ ok, number, url, repo, base, head, title }`。`base == head` 时直接拒绝（否则 Gogs 会建出一个空 PR）。失败时尽量说清原因：两个分支没有差异、这对分支已经有 PR，或者 Gogs 自己的报错（`detail`）。 |
| `sggit/pr-list` | `[repo] [status]` / `--status open\|closed\|all` | 解析 `/pulls` 页面（`all` 会把 open 和 closed 都取一遍），默认 `open`。返回 `{ repo, status, count, pulls }`，每项 `{ number, title, state, url }`，按编号从新到旧。 |
| `sggit/pr-merge` | `--pr <n> [--repo] [--style] [--message]` | **会写入。** POST `/pulls/<n>/merge`（`_csrf` + `merge_style`）；`--style` 可选 `create_merge_commit`（默认）、`rebase`、`squash`，需要服务器端已启用。合完会重新读一次 PR 确认：`{ ok, merged, number, url, style }`。已经合过的 PR 返回 `{ ok, already: true, merged: true }`。有冲突、页面上没有合并表单（PR 已关闭或没权限）、合并没生效，都会报错，不会做一半。主要给 **dev** 那个 PR 用，对 feature-test/main 要谨慎。 |

## 注意事项

- **`--state` 是 chrome-use 保留的全局 flag**，到不了 adapter。所以 `pr-list` 用的是 `--status`，或者直接用**位置参数**（位置参数总能传进去）。`--base/--head/--title/--body/--repo` 不冲突。
- Gogs 的 `_csrf` 是**整个会话共用的**，所以 `pr-create` 从轻量的仓库首页取 token，而不是去下载可能很大的 diff 页。
- 返回 401/403 说明没登录 Gogs，或者 WARP 没连上。

## 安全与测试

这些 adapter 用的是你真实的 Gogs 账号，`pr-create` / `pr-merge` 会改动真实仓库。验证改动优先用带桩的测试，少做实际调用（见 AGENTS.md）；不要为了测 adapter 去真的建 PR 或合 PR。

## 测试

这个 pack 目前还没有测试。在仓库根目录跑 `node --test` 会执行其他 pack 的测试。

变更记录见 [CHANGELOG](../CHANGELOG.md)。
