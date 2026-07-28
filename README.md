# chrome-use-sites

The official **[chrome-use](https://github.com/leeguooooo/chrome-use) site adapter source**. It contains adapters maintained by the chrome-use project, including ones for internal or self-hosted services that do not belong in the public [`epiral/bb-sites`](https://github.com/epiral/bb-sites) community source.

A *site adapter* is a small JS function with a `/* @meta {…} */` header. `chrome-use site <name>/<cmd>` navigates to the adapter's domain **in your own logged-in tab** and runs the function there, returning structured JSON — no scraping, no screenshots, and it works behind auth/VPN because it runs as you.

chrome-use has two built-in adapter sources:

- Community: [`epiral/bb-sites`](https://github.com/epiral/bb-sites)
- Official: [`leeguooooo/chrome-use-sites`](https://github.com/leeguooooo/chrome-use-sites)

Both are fetched automatically on first use and by `chrome-use site update`. No `site add` or separate installer is required in versions containing [chrome-use#133](https://github.com/leeguooooo/chrome-use/pull/133).

## Install and update

```sh
chrome-use site update
chrome-use site sources
chrome-use site list | grep '^sggit/'
```

For chrome-use v1.5.77 and earlier, use the legacy installer:

```sh
curl -fsSL https://raw.githubusercontent.com/leeguooooo/chrome-use-sites/main/install.sh | sh
```

Adapters run in your logged-in browser tab, so **sign in to the target site first** (and connect VPN/WARP if it's internal).

## Packs

### `twitter/` — X search and conversation threads

The official Twitter adapters return a stable engagement schema. Every tweet
includes `likes`, `retweets`, `replies`, `bookmarks`, and numeric `views`.
When X omits or restricts a metric, its value is `null`.

```sh
chrome-use site twitter/search "chrome-use" --count 20
chrome-use site twitter/thread 2048506314163458106
```

### `sggit/` — self-hosted Gogs (`sg-git.pwtk.cc`)

One-command pull requests on our internal Gogs, instead of clicking through the compare page.

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

`repo` defaults to `ka-cn/super-admin`. `pr-create` returns `{ ok, number, url }` on success.

| adapter | args | notes |
| --- | --- | --- |
| `sggit/pr-create` | `--base --head --title [--body] [--repo]` | POSTs the Gogs compare form (`_csrf`+`title`+`content`); 302 → the new PR. Refuses `base==head` (Gogs would otherwise create an empty PR). |
| `sggit/pr-list` | `[repo] [status]` / `--status open\|closed\|all` | Parses the `/pulls` page. |
| `sggit/pr-merge` | `--pr <n> [--repo] [--style] [--message]` | POSTs `/pulls/<n>/merge` (`_csrf`+`merge_style`); default `create_merge_commit`. Detects conflicts / already-merged / no-permission and errors instead of half-acting. Meant for the **dev** PR — use with care on feature-test/main. |

**Gotchas** (baked into the adapters / learned the hard way):

- **`--state` is a reserved chrome-use global flag** and gets swallowed before it reaches the adapter. That's why `pr-list` uses `--status`, not `--state` — or just pass args **positionally** (they always forward). `--base/--head/--title/--body/--repo` don't collide.
- Gogs' `_csrf` is **session-global**, so the adapter reads it from the light repo home page instead of downloading a huge diff page.
- Requires **WARP connected** and a logged-in Gogs session in the browser chrome-use drives.

## Adding an adapter

Drop `packname/command.js` in this repo and follow the shape of the existing files. Current chrome-use versions discover `.js` adapters directly from the repository tree. Also add the path to `PACKS` in `install.sh` while the legacy v1.5.77 installer remains supported.

```js
/* @meta
{ "name": "packname/command", "domain": "host.example.com",
  "args": { "foo": {"required": true, "description": "…"} },
  "capabilities": ["network"], "readOnly": true }
*/
async function (args) {
  // runs in the logged-in tab on `domain`; same-origin fetch has cookies.
  return { /* structured JSON */ };
}
```

Avoid arg names that collide with chrome-use global flags (`state`, `profile`, `session`, `timeout`, `url`, `fn`, …).
