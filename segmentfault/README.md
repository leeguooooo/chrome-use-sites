# `segmentfault/` — cross-post a Markdown article to SegmentFault (思否)

English · [中文](README.zh.md)

`segmentfault/article-publish` posts a Markdown article to [segmentfault.com](https://segmentfault.com) as the signed-in user. It saves a draft and then publishes it, or stops after the draft with `--draft true`. It writes to your real account. You must be signed in to segmentfault.com in the browser chrome-use drives; otherwise it stops before writing anything.

## Commands

```sh
# save a draft only (try this first)
chrome-use site segmentfault/article-publish --title "My title" --markdown @post.md \
  --tags "claude,codex,开源" --draft true

# save the draft and publish it as 原创
chrome-use site segmentfault/article-publish --title "My title" --markdown @post.md \
  --tags "claude,codex,开源"

# a repost needs the original URL
chrome-use site segmentfault/article-publish --title "My title" --markdown @post.md \
  --tags "claude" --type 转载 --source_url https://example.com/original-post
```

`--markdown` takes the whole body as a string; pass a file with `@post.md`, or `@-` for stdin. chrome-use before 1.5.149 needs `--markdown "$(cat post.md)"`.

## Adapters

| adapter | args | returns / does |
| --- | --- | --- |
| `segmentfault/article-publish` | `--title` (required), `--markdown` (required), `--tags`, `--type`, `--source_url`, `--draft`, `--summary` (ignored) | Saves the draft with `POST /gateway/draft` (the same fields the /write page autosaves), then publishes with `POST /gateway/article` and the draft id. Returns `{ok, id, draft_id, url, status, message, tags, skipped_tags}` or `{error, hint}`. |

- **Requests.** segmentfault.com sends its gateway calls through one Api object in the page (a token header, and a signed query string on GETs). The adapter finds that object in the page bundle and calls its methods instead of rebuilding the token and signature. If the bundle changed and it cannot be found, the run fails with an error saying the adapter needs updating.
- **Body.** The Markdown is sent as-is; SegmentFault renders it. `--summary` is accepted and ignored (SegmentFault builds the excerpt from the body), so one command line works for every platform.
- **Tags.** Comma-separated. Each name is searched with SegmentFault's tag search and used only on an exact match, then a case-insensitive one. At most 5 are used; the rest come back in `skipped_tags`. Publishing needs at least one existing tag.
- **Type.** `--type` is `原创` (default), `转载` or `翻译` (`original`, `repost`, `translation` or `1`/`2`/`3` also work). Publishing a 转载 or 翻译 needs `--source_url`.
- **Checks before writing.** Missing title or body, an unknown type, not signed in, and (when publishing) no existing tag or a 转载/翻译 without `--source_url` all stop the run before a draft is saved.
- **Result.** Draft: `status: "draft"`, `id` is the draft id, `url` is the draft list `https://segmentfault.com/user/draft`. Published: `id` is the article id and `url` is `https://segmentfault.com/a/<id>`. New accounts' articles go to manual review (up to four hours): `status` is then `in_review`, and `message` carries SegmentFault's text; otherwise `status` is `published`.
- **Verification.** If SegmentFault answers the publish with a `scene_id` (a captcha or other check), the run stops with `status: "draft"` and the draft kept. Finish the check by hand at https://segmentfault.com/write and publish the draft there; do not retry the command.
- **Publish failed after the draft was saved.** The result has `error`, `status: "draft"` and the draft id. Do not re-run, which would create a second draft; finish it at https://segmentfault.com/user/draft.

One run is one article. Delete test drafts afterwards.

## Tests

`node --test segmentfault/`

The tests use a stubbed Api object; nothing goes to the live site.

Same adapter for: [juejin](../juejin/) · [csdn](../csdn/) · [zhihu](../zhihu/)
See [CHANGELOG](../CHANGELOG.md) for changes.
