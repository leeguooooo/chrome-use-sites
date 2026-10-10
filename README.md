# chrome-use-sites

English · [中文](README.zh.md)

The official **[chrome-use](https://github.com/leeguooooo/chrome-use) site adapter source**. It contains adapters maintained by the chrome-use project, including ones for internal or self-hosted services that do not belong in the public [`epiral/bb-sites`](https://github.com/epiral/bb-sites) community source.

A *site adapter* is a small JS function with a `/* @meta {…} */` header. `chrome-use site <name>/<cmd>` navigates to the adapter's domain **in your own logged-in tab** and runs the function there, returning structured JSON — no scraping, no screenshots, and it works behind auth/VPN because it runs as you.

chrome-use has two built-in adapter sources:

- Community: [`epiral/bb-sites`](https://github.com/epiral/bb-sites)
- Official: [`leeguooooo/chrome-use-sites`](https://github.com/leeguooooo/chrome-use-sites)

Both are fetched automatically on first use and by `chrome-use site update`. The official pack is synced last, so it wins a name both packs have. No `site add` or separate installer is required in versions containing [chrome-use#133](https://github.com/leeguooooo/chrome-use/pull/133).

chrome-use can also run some commands from [OpenCLI](https://github.com/jackwener/opencli) (`@jackwener/opencli`), but only names neither pack has: an adapter here always takes priority over OpenCLI's command of the same name. Commands we rely on are ported here and maintained here instead of being run from OpenCLI: `douyin/delete`, `douyin/update` and `twitter/delete`, under OpenCLI's Apache-2.0 license with attribution (see each pack's README).

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

Each pack documents itself in its own folder, in English (`README.md`) and Chinese (`README.zh.md`).

| pack | site | adapters | |
| --- | --- | --- | --- |
| [`twitter/`](twitter/) | x.com | `search`, `thread`, `user`, `post`, `delete` | read + post + delete |
| [`xiaohongshu/`](xiaohongshu/) | www.xiaohongshu.com | `me` | read |
| [`xiaohongshu-creator/`](xiaohongshu-creator/) | creator.xiaohongshu.com | `me`, `notes`, `note-stats` | read |
| [`douyin-creator/`](douyin-creator/) | creator.douyin.com | `me`, `works`, `video-publish` | read + publish |
| [`douyin/`](douyin/) | creator.douyin.com | `delete`, `update` | delete + edit works |
| [`bilibili-creator/`](bilibili-creator/) | member.bilibili.com | `video-publish` | publish |
| [`youtube-studio/`](youtube-studio/) | studio.youtube.com | `channel`, `video-upload` | read + publish |
| [`juejin/`](juejin/) · [`csdn/`](csdn/) · [`segmentfault/`](segmentfault/) · [`zhihu/`](zhihu/) | Chinese dev platforms | `article-publish` | publish |
| [`chatgpt/`](chatgpt/) | chatgpt.com | `me`, `conversations`, `conversation`, `projects`, `models`, `images`, `open-project` | read (+ open project) |
| [`appstoreconnect/`](appstoreconnect/) | appstoreconnect.apple.com | `apps`, `app-create`, `builds` | read + create |
| [`si12333/`](si12333/) | si.12333.gov.cn | `pension-payments` | read |
| [`sggit/`](sggit/) | sg-git.pwtk.cc (self-hosted Gogs) | `pr-create`, `pr-list`, `pr-merge` | read + write |

Changes are logged in [CHANGELOG.md](CHANGELOG.md). Contribution rules, required for every PR: [CONTRIBUTING.md](CONTRIBUTING.md).

## Adding an adapter

Read [CONTRIBUTING.md](CONTRIBUTING.md) first: every change updates the pack's `README.md` and `README.zh.md` and adds a `CHANGELOG.md` entry, and CI fails the PR otherwise.

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

## License

MIT, see [LICENSE](LICENSE). Contributions are accepted under the same license. Exception: the files ported from OpenCLI (`douyin/delete.js`, `douyin/update.js`, `twitter/delete.js`) stay under the Apache License 2.0, with its text next to them (`LICENSE-OpenCLI`) and a header in each file saying what changed.
