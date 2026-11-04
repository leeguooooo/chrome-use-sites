# `google/` — Google web search

English · [中文](README.zh.md)

One read-only adapter for [Google](https://www.google.com) search. No sign-in needed. chrome-use runs it in a `www.google.com` tab.

It replaces the community pack's ([epiral/bb-sites](https://github.com/epiral/bb-sites)) `google/search`, which chrome-use now runs from here instead. The community version returned `{"count": 0}` with no error whenever its parse missed, and passed through Google's relative `/goto?url=…` links, so callers got neither the destination nor its domain.

## Commands

```sh
chrome-use site google/search "chrome-use"
chrome-use site google/search "chrome-use" --count 25 --json   # reads ?start=10, ?start=20
```

## Adapters

| adapter | args | returns / does |
| --- | --- | --- |
| `google/search` | `<query>` `[--count N]` (default 10, 1 to 50) | Reads Google's same-origin results pages (`/search?q=`, ten a page). Returns `{ query, count, pages_read, results }`, each result `title, url, domain, display_url, redirect, snippet`. |

- `url` is always absolute. A direct link is returned as is, `/url?q=` is unwrapped, and Google's `/goto?url=<token>` redirect becomes `https://www.google.com/goto?url=<token>` with `redirect: true`. The token is opaque, not the destination, and the page cannot follow the cross-origin redirect, so use `domain` / `display_url` to see where it goes, or open `url` in a browser.
- `domain` is the link's host, or for a redirect, the host Google prints under the title (`display_url`, e.g. `https://github.com › user › repo`).

### Limits

- A results page that parses to no results is an **error** with a hint (open the search in the tab and read it), never a silent `count: 0`. If the tab is already on the same query's results, the adapter reads the rendered page first.
- In a profile that has never loaded a Google results page, Google answers the adapter's background request with its script check. The adapter then loads the results page in the tab and returns an error with `retry: true`; run the same command again.
- When Google says the query matched nothing, the result is `{ count: 0, results: [], no_results: true }`. This is recognised in English, Chinese, Japanese and Korean.
- A CAPTCHA (`/sorry/`, HTTP 429) is an error; solve it in the tab and retry.
- Pages after the first wait 0.4–1 s between requests.

## Tests

`node --test google/` runs the adapter against the pages in `fixtures/` with a stubbed `fetch` and the small DOM in `douyin-creator/fakedom.mjs`.
