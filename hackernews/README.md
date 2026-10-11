# `hackernews/` — Hacker News front page and comment threads

English · [中文](README.zh.md)

Two read-only adapters for [Hacker News](https://news.ycombinator.com). No sign-in needed. chrome-use runs them in a `news.ycombinator.com` tab.

These replace the community pack's ([epiral/bb-sites](https://github.com/epiral/bb-sites)) `hackernews/top` and `hackernews/thread`, which chrome-use now runs from here instead. The community versions call the Firebase API (`hacker-news.firebaseio.com`) from the page, but HN serves `Content-Security-Policy: default-src 'self'` with no `connect-src`, so that fetch is blocked and they always failed with `TypeError: Failed to fetch`. These read HN's own same-origin HTML (`/news`, `/news?p=2`, `/item?id=`) and return the same fields.

## Commands

```sh
chrome-use site hackernews/top                 # top 20
chrome-use site hackernews/top 50 --json       # reads /news and /news?p=2
chrome-use site hackernews/thread 50043026
chrome-use site hackernews/thread https://news.ycombinator.com/item?id=50043026 --depth 4
```

## Adapters

| adapter | args | returns / does |
| --- | --- | --- |
| `hackernews/top` | `[count]` (default 20, 1 to 50) | The front page (`/news`, 30 a page). Returns `{ count, posts }`, each post `rank, id, title, url, hn_url, author, score, comments`. `url` is `null` for self posts (Ask HN). Job ads have no score or author and are left out (`non_story_omitted`). |
| `hackernews/thread` | `<id>` (item id or `item?id=` URL) `[--depth N]` (default 2, 0 to 5) | The item page (`/item?id=`). Returns `{ post, comments }`: `post` is `id, title, url, hn_url, author, score, comments_count, time, text`; each comment is `id, author, text, time, depth, replies`. `text` is HTML, as in the API; `time` is unix seconds. |

Both wrap the result in the `pinix.site-adapter-result.v1` envelope (`__pinix_site_result.metadata` with `completeness`, `reason`, `pagination`, `warnings`) the community versions used.

### Limits

- `top`: `total_available` is how many front-page rows were read, not HN's whole top-500 list; `more_available` says whether HN had a "More" link after them.
- `thread`: at most 30 replies per comment and `depth` levels, as before. Deleted, dead and flagged comments are dropped with their replies (`deleted_dead_omitted`). Very large threads are split by HN into pages; up to 5 are read (`pages_read`, `more_pages_unread`).
- The page shows what the signed-in user sees: with `showdead` on, dead comments are still detected and dropped.

## Safety / testing

Read-only and public. A live check is fine, but keep it to a few runs.

## Tests

`node --test hackernews/` runs both adapters against the pages in `fixtures/`, with a stubbed `fetch` that rejects any origin other than `news.ycombinator.com`, as HN's CSP does.

See [CHANGELOG](../CHANGELOG.md) for changes.
