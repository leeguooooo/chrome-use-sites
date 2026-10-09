# Agent rules for chrome-use-sites

## Docs and changelog are required

Every change follows [CONTRIBUTING.md](CONTRIBUTING.md): each pack keeps a `README.md` and a `README.zh.md` covering every adapter it has, and each change gets a dated entry in `CHANGELOG.md`. `docs.test.js` fails the build otherwise, and CI runs `node --test` on every PR.

## Never test the chatgpt/ adapters against the live ChatGPT

Do **not** run `chrome-use site chatgpt/*`, or open chatgpt.com in scratch sessions, to check an adapter. They run in the user's own signed-in browser, and chatgpt.com throttles that account by **request count**. A full page load is about 45 backend requests, and scripted live checks have already tripped "Too many requests" on the account the user works in.

Verify offline:

```sh
node --test
```

The tests load each adapter the way chrome-use does (with its family `_helper.js` in scope) against stubbed `fetch` and `document`; see `loadAdapter` and `router` in `chatgpt/adapters.test.js`. New behaviour gets a stubbed test there. If something can only be confirmed live, say so in the PR and leave it unverified.

The same caution applies to other packs that drive a real logged-in account (twitter/, sggit/, xiaohongshu-creator/, douyin-creator/): prefer the stubbed tests to live calls. Xiaohongshu bans accounts for scripted behaviour, so a live check of `xiaohongshu-creator/*` is one run per adapter, one page, and never a loop. Develop against `xiaohongshu-creator/fixtures/`. Treat `douyin-creator/*` (creator.douyin.com) the same way: one live check per adapter, one page, never a loop, only as a private draft on a throwaway clip that you discard afterwards (放弃 on the upload page); never publish, never touch existing works. Develop against `douyin-creator/fixtures/`. Treat `bilibili-creator/*` (member.bilibili.com) the same way: one live run per adapter, never a loop; develop against `bilibili-creator/fixtures/`, publish only a video the user asked to publish, never touch the account's other videos. `youtube-studio/*` publishes to a real YouTube channel: develop against `youtube-studio/fixtures/`, and a live check uploads only a video the user asked to publish, as `--visibility private` first; never touch the channel's other videos.

## Adding an adapter

Add its path to `PACKS` in `install.sh`; the guard tests fail if an adapter is missing from it or a listed file doesn't exist.
