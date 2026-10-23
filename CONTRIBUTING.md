# Contributing

English · [中文](CONTRIBUTING.zh.md)

These rules are required. `node --test` checks rules 1–3 and 6 and runs on every
pull request; a PR that fails it is not merged.

1. **Bilingual docs per pack.** Every pack directory has `README.md` (English)
   and `README.zh.md` (Chinese), linking to each other, and both mention every
   adapter in the pack. GitHub shows `README.md` when someone opens the folder,
   so keep it complete: what the pack does, commands, args, returned fields,
   limits. Change an adapter, update both files in the same PR.
2. **Changelog.** Add a dated entry (`## YYYY-MM-DD`, newest first) to
   [CHANGELOG.md](CHANGELOG.md) naming each adapter you add or change.
3. **Installer list.** Add every new adapter file to `PACKS` in `install.sh`.
4. **Tests without the live site.** New behaviour gets a stubbed test in the
   pack (`node --test <pack>/`). Fixtures are captured responses trimmed to the
   fields the adapter reads; remove anything private before committing, since
   this repo is public.
5. **Live checks are rationed.** Read [AGENTS.md](AGENTS.md) before running an
   adapter against a real account: never against the live ChatGPT; one run per
   adapter, never a loop, on Xiaohongshu, Douyin and Bilibili; never publish,
   delete or change content nobody asked for.
6. **Stealth first.** Adapters act in the user's real, signed-in account, and
   anything the page can see can get it throttled or banned. A write adapter's
   clicks, typing, key presses and scrolling go through `args.ui` (real input
   events from chrome-use); its own `el.click()`, `dispatchEvent` and
   `execCommand` stay only as the fallback for older chrome-use. A write
   adapter that drives the page declares `"world": "isolated"` and reaches
   page-only JS (React fibers, app stores, the page's own signed fetch) through
   `args.page(fn, ...args)`. No named
   globals on `window`, no patching page objects or prototypes (such as
   `XMLHttpRequest.prototype`), no DOM nodes left in the page, and fixed waits
   get jitter. `stealth.test.js` checks the first two; reviewers check the rest
   before merging.

Adapter format and naming: see "Adding an adapter" in the [README](README.md).
