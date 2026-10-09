# `sggit/` — pull requests on our self-hosted Gogs (`sg-git.pwtk.cc`)

English · [中文](README.zh.md)

One-command pull requests on our internal Gogs at `sg-git.pwtk.cc`, instead of clicking through the compare page. `pr-list` is read-only; `pr-create` and `pr-merge` write (they post the same forms the web UI posts). You must be signed in to `sg-git.pwtk.cc` in the browser chrome-use drives, with **WARP connected**.

## Commands

```sh
# create a PR (the 3-PR flow: run once per base)
chrome-use site sggit/pr-create --base dev          --head feat/leo/xxx --title "feat: xxx" --body "..."
chrome-use site sggit/pr-create --base feature-test --head feat/leo/xxx --title "feat: xxx" --body "..."
chrome-use site sggit/pr-create --base main         --head feat/leo/xxx --title "feat: xxx" --body "..."

# merge a PR (the dev one auto-merges in our flow)
chrome-use site sggit/pr-merge --pr 134

# list PRs
chrome-use site sggit/pr-list ka-cn/super-admin closed   # positional
chrome-use site sggit/pr-list --status all               # or a flag
```

`--repo` (`owner/name`) defaults to `ka-cn/super-admin` on every adapter.

## Adapters

| adapter | args | returns / does |
| --- | --- | --- |
| `sggit/pr-create` | `--base --head --title [--body] [--repo]` | **Writes.** POSTs the Gogs compare form (`_csrf` + `title` + `content`); the 302 lands on the new PR. Returns `{ ok, number, url, repo, base, head, title }`. Refuses `base == head` (Gogs would otherwise create an empty PR). On failure it says why when it can: no changes between the branches, a PR for these branches already exists, or Gogs' own error message (`detail`). |
| `sggit/pr-list` | `[repo] [status]` / `--status open\|closed\|all` | Parses the `/pulls` page (`all` fetches both open and closed). Default `open`. Returns `{ repo, status, count, pulls }`, each `{ number, title, state, url }`, newest first. |
| `sggit/pr-merge` | `--pr <n> [--repo] [--style] [--message]` | **Writes.** POSTs `/pulls/<n>/merge` (`_csrf` + `merge_style`); `--style` is `create_merge_commit` (default), `rebase` or `squash`, and must be enabled on the server. Then re-reads the PR to confirm it merged: `{ ok, merged, number, url, style }`. An already-merged PR returns `{ ok, already: true, merged: true }`. Conflicts, a missing merge form (closed PR or no permission) and a merge that did not complete are errors, so it never half-acts. Meant for the **dev** PR — use with care on feature-test/main. |

## Gotchas

- **`--state` is a reserved chrome-use global flag** and gets swallowed before it reaches the adapter. That's why `pr-list` uses `--status`, not `--state` — or just pass args **positionally** (they always forward). `--base/--head/--title/--body/--repo` don't collide.
- Gogs' `_csrf` is **session-global**, so `pr-create` reads it from the light repo home page instead of downloading a potentially huge diff page.
- A 401/403 means you are not logged in to Gogs or WARP is not connected.

## Safety / testing

These adapters act as your real Gogs account and `pr-create` / `pr-merge` change real repositories. Prefer stubbed tests to live calls (AGENTS.md); don't create or merge PRs just to check an adapter.

## Tests

This pack has no tests yet. `node --test` at the repo root runs the other packs' tests.

See [CHANGELOG](../CHANGELOG.md) for changes.
