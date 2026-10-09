# `xiaohongshu/` — your Xiaohongshu profile counts on www.xiaohongshu.com

English · [中文](README.zh.md)

This official pack has one adapter, `xiaohongshu/me`. It reads the signed-in user's profile on `www.xiaohongshu.com` (关注 / 粉丝 / 获赞与收藏, IP 属地, optionally the newest notes) without the creator center's separate login. It is read-only. You must be signed in to `www.xiaohongshu.com` (QR code) in the browser chrome-use drives.

The other `xiaohongshu/*` commands come from the community pack [`epiral/bb-sites`](https://github.com/epiral/bb-sites). This `me` overrides the community `xiaohongshu/me`, which has no counts: the official pack syncs last and wins on a shared name. The community version's fields keep their names. For your own creator-center data (note list, analytics), see [`xiaohongshu-creator/`](../xiaohongshu-creator/README.md).

## Commands

```sh
chrome-use site xiaohongshu/me
chrome-use site xiaohongshu/me --notes 10     # plus the newest notes (max 30)
```

## Adapters

| adapter | args | returns / does |
| --- | --- | --- |
| `xiaohongshu/me` | `[--notes N]` (default 0, max 30: the profile page's first load) | `userid`, `nickname`, `red_id`, `desc`, `gender`, `ip_location` (IP 属地), `follows`, `fans`, `likes_and_collects` (获赞与收藏; Xiaohongshu only shows the combined figure), `url`. With `--notes`, a `notes` list; each note: `note_id`, `title`, `type`, `likes`, `sticky`, `url` (with its `xsec_token`). The signed-in user comes from the page's Pinia user store; the counts come from one GET of your profile page, parsed from its server-rendered `window.__INITIAL_STATE__`. |

## Safety / testing

- One request per run (the profile page), no API calls and no paging: Xiaohongshu bans accounts for scripted traffic.
- Don't loop or poll it. If you need to check it live, run it once.
- Not signed in returns `{error: "Not logged in", hint}`; open `https://www.xiaohongshu.com` and log in with the QR code.

## Tests

`node --test xiaohongshu/`

See [CHANGELOG](../CHANGELOG.md) for changes.
