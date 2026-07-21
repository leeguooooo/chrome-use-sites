# chrome-use-sites

Org / private **[chrome-use](https://github.com/leeguooooo/chrome-use) site adapters** — the ones that don't belong in the public [`epiral/bb-sites`](https://github.com/epiral/bb-sites) community pack because they target internal or self-hosted services.

A *site adapter* is a small JS function with a `/* @meta {…} */` header. `chrome-use site <name>/<cmd>` navigates to the adapter's domain **in your own logged-in tab** and runs the function there, returning structured JSON — no scraping, no screenshots, and it works behind auth/VPN because it runs as you.

chrome-use only auto-syncs the public pack (`chrome-use site update` pulls `epiral/bb-sites`). It has **no built-in mechanism for a private/second source** yet (see the upstream proposal: [leeguooooo/chrome-use#127](https://github.com/leeguooooo/chrome-use/issues/127)). Custom adapters dropped into `~/.chrome-use/sites/` **do survive `site update`** (it merges, it doesn't wipe), so this repo just installs them there.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/leeguooooo/chrome-use-sites/main/install.sh | sh
```

Then:

```sh
chrome-use site list | grep sggit
```

Adapters run in your logged-in browser tab, so **sign in to the target site first** (and connect VPN/WARP if it's internal).

## Packs

### `sggit/` — self-hosted Gogs (`sg-git.pwtk.cc`)

One-command pull requests on our internal Gogs, instead of clicking through the compare page.

```sh
# create a PR (the 3-PR flow: run once per base)
chrome-use site sggit/pr-create --base dev          --head feat/leo/xxx --title "feat: xxx" --body "..."
chrome-use site sggit/pr-create --base feature-test --head feat/leo/xxx --title "feat: xxx" --body "..."
chrome-use site sggit/pr-create --base main         --head feat/leo/xxx --title "feat: xxx" --body "..."

# list PRs
chrome-use site sggit/pr-list ka-cn/super-admin closed   # positional
chrome-use site sggit/pr-list --status all               # or a flag
```

`repo` defaults to `ka-cn/super-admin`. `pr-create` returns `{ ok, number, url }` on success.

| adapter | args | notes |
| --- | --- | --- |
| `sggit/pr-create` | `--base --head --title [--body] [--repo]` | POSTs the Gogs compare form (`_csrf`+`title`+`content`); 302 → the new PR. Refuses `base==head` (Gogs would otherwise create an empty PR). |
| `sggit/pr-list` | `[repo] [status]` / `--status open\|closed\|all` | Parses the `/pulls` page. |

**Gotchas** (baked into the adapters / learned the hard way):

- **`--state` is a reserved chrome-use global flag** and gets swallowed before it reaches the adapter. That's why `pr-list` uses `--status`, not `--state` — or just pass args **positionally** (they always forward). `--base/--head/--title/--body/--repo` don't collide.
- Gogs' `_csrf` is **session-global**, so the adapter reads it from the light repo home page instead of downloading a huge diff page.
- Requires **WARP connected** and a logged-in Gogs session in the browser chrome-use drives.

## Adding an adapter

Drop `packname/command.js` in this repo, add its path to `PACKS` in `install.sh`, and follow the shape of the existing files:

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
