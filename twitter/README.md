# `twitter/` — X search, conversation threads, profiles, posting, likes and follows

English · [中文](README.zh.md)

Adapters for `x.com` that call X's own GraphQL endpoints from your logged-in tab. `search`, `thread` and `user` are read-only; `post` writes: it publishes a tweet or reply from the signed-in account; `delete` deletes one of its tweets; `like` likes a tweet and `follow` follows an account, both through the page like a person and never undoing an existing like or follow. You must be signed in to `x.com` in the browser chrome-use drives (the adapters need the `ct0` cookie).

Every tweet returned by `search` and `thread` has the same engagement schema: `likes`, `retweets`, `replies`, `bookmarks` and numeric `views`. When X omits or restricts a metric, its value is `null`.

## Commands

```sh
chrome-use site twitter/search "chrome-use" --count 20
chrome-use site twitter/search "chrome-use" --type top
chrome-use site twitter/thread 2048506314163458106
chrome-use site twitter/user                 # the signed-in account
chrome-use site twitter/user leeguooooo

chrome-use site twitter/post --text @tweet.txt --dry_run true
chrome-use site twitter/post --text @tweet.txt
chrome-use site twitter/post --text @second.txt --reply_to https://x.com/you/status/123
chrome-use site twitter/post --text @tweet.txt --media ./clip.mp4 --timeout 5m   # native video
chrome-use site twitter/delete https://x.com/you/status/123 --until-done
chrome-use site twitter/like https://x.com/someone/status/123 --until-done
chrome-use site twitter/follow someone --until-done
```

## Adapters

| adapter | args | returns / does |
| --- | --- | --- |
| `twitter/search` | `<query> [--count N] [--type latest\|top]` | `SearchTimeline`. `count` defaults to 20, capped at 50; `type` defaults to `latest`. Returns `{ query, product, count, tweets }`, each tweet `id, author, name, url, text, likes, retweets, replies, bookmarks, views, in_reply_to, created_at`. |
| `twitter/thread` | `<tweet_id>` (numeric id or status URL) | `TweetDetail`, the focal tweet plus replies, following the cursor for up to 5 pages. Returns `{ tweet_id, count, tweets }`, each tweet `id, author, text, url, likes, retweets, replies, bookmarks, views, in_reply_to, created_at`. |
| `twitter/user` | `[screen_name]` (handle without `@`; a profile URL also works) | `UserByScreenName`. Without a handle it reads the signed-in one from the side nav's Profile link. Returns `id, name, screen_name, url, bio, location, website, created_at, followers, following, tweets, media, likes, pinned_tweet_ids, verified`. |
| `twitter/post` | `--text <text\|@file> [--reply_to <id\|url>] [--media <file>] [--dry_run true]` | **Writes.** Posts through X's `CreateTweet` call with the same `X-Client-Transaction-Id` header the web app sends. Returns `{ ok, id, url, weighted_length, in_reply_to, media }`. `--dry_run true` returns `{ ok, dry_run, weighted_length, variables, media }` without sending anything. |
| `twitter/delete` | `<tweet>` (status URL or numeric id) | **Deletes.** Opens the tweet, its ⋯ menu, Delete, and confirms, like a person. Returns `{ ok, status: "deleted", id }`. Run it with `--until-done`: off the tweet's page the first run returns `status: "navigating"` and opens it, and the rerun deletes. |
| `twitter/like` | `<tweet>` (status URL or numeric id) | **Writes.** Opens the tweet and clicks its heart. Returns `{ ok, status: "liked" \| "already_liked", id }`; an already-liked tweet is not clicked. Run it with `--until-done` (first run: `status: "navigating"`). |
| `twitter/follow` | `<username>` (handle with or without `@`, or profile URL) | **Writes.** Opens the profile and clicks its Follow button. Returns `{ ok, status: "followed" \| "requested" \| "already_following" \| "already_requested", username, user_id }`; an account already followed is not clicked. Run it with `--until-done` (first run: `status: "navigating"`). |

### `twitter/user` details

It reads both shapes of `UserByScreenName`: the 2026 one, where the counts moved out of `legacy` into `relationship_counts` / `tweet_counts` / `action_counts`, and the older `legacy` one. `website` is the expanded URL when X provides it, otherwise the t.co link. It overrides the community `twitter/user`, which returned no counts once X moved them.

### `twitter/post` details

- **Length check before anything is sent.** The text is weighted the way X counts it: CJK characters (and anything outside the Latin/punctuation ranges, e.g. emoji) count 2, every link counts 23, the limit is 280. Over the limit it returns an error with `weighted_length` and nothing is posted. To post a longer text, split it and post the rest with `--reply_to` the first tweet; that is how a thread is built.
- **`--media`** attaches a local video (mp4/mov) or image. It is uploaded the way the web composer does: chunked `INIT` / `APPEND` / `FINALIZE`, then waiting (up to 4 minutes) for X to process a video. Any upload or processing failure returns an error and posts nothing. Use `--timeout 5m` for a large video. Needs chrome-use 1.5.149+.
- **Outcomes.** If X refuses the tweet (a duplicate, an automation check, a stale queryId), the error says nothing was posted. If X answers without a tweet id, the result carries `outcome: "unknown"`: check the profile before posting again.

### `twitter/delete` details

- Only the `<article>` whose own status link is the tweet is touched, so a quoted or replied-to tweet on the same page is never the one deleted. The menu's Lists row ("Add/remove from Lists" / 列表) is never clicked; English and Chinese UIs both work.
- Errors, all with nothing deleted: `tweet_not_found` (not on its page: deleted already, or not visible), `menu_not_found`, `not_own_tweet` (the menu has no Delete), `confirm_not_shown`.
- Ported from [OpenCLI](https://github.com/jackwener/opencli) v1.8.8 `clis/twitter/delete.js` and helpers from `clis/twitter/shared.js`, Copyright 2025 jackwener, under the Apache License 2.0 ([LICENSE-OpenCLI](LICENSE-OpenCLI)); the file's header says what chrome-use changed. chrome-use runs this file instead of OpenCLI's `twitter/delete`.

### `twitter/like` and `twitter/follow` details

- **Idempotent.** An Unlike heart means `already_liked`; a Following / Pending button means `already_following` / `already_requested`. Neither is clicked, so a rerun never unlikes or unfollows.
- **The right target.** `like` clicks only inside the `<article>` whose own status link is the tweet, so a parent tweet or reply on the same conversation page is never liked. `follow` clicks only the profile's own button (`data-testid="<user id>-follow"` whose label names the handle), never a "Who to follow" / "You might like" suggestion, and refuses to guess between two unlabelled buttons.
- **Verified.** After the click each waits up to 6 s for the button to change on that same tweet or user: Unlike, or Following (`followed`) / Pending (`requested`, a protected account). Otherwise the result is `error: "unconfirmed"`: check the page; rerunning is safe.
- Errors, all with nothing clicked: `tweet_not_found`, `like_button_not_found` (signed out?), `follow_button_not_found`, `own_account`, `user_not_found`, `blocked`, and bad input (a handle is validated before it is used).
- Ported from [OpenCLI](https://github.com/jackwener/opencli) v1.8.8 `clis/twitter/like.js` and `clis/twitter/follow.js` (with helpers from `clis/twitter/shared.js`), Copyright 2025 jackwener, under the Apache License 2.0 ([LICENSE-OpenCLI](LICENSE-OpenCLI)); each file's header says what chrome-use changed. chrome-use runs these files instead of OpenCLI's `twitter/like` and `twitter/follow`.

### Dependency

The GraphQL adapters (`search`, `thread`, `user`, `post`) call `findGraphQLQueryId` / `findTransactionIdGenerator`, which live in the community pack's `twitter/_helper.js` ([epiral/bb-sites](https://github.com/epiral/bb-sites)), not in this repo. `install.sh` fetches it pinned to a commit.

## Safety / testing

These adapters act as your real X account, so prefer the stubbed tests to live calls (AGENTS.md). `twitter/post --dry_run true` checks the text and shows what would be sent without posting.

## Tests

`node --test twitter/`

See [CHANGELOG](../CHANGELOG.md) for changes.
