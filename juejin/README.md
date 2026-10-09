# `juejin/` — cross-post a Markdown article to Juejin (掘金)

English · [中文](README.zh.md)

`juejin/article-publish` posts a Markdown article to [juejin.cn](https://juejin.cn) as the signed-in user. It creates a draft and then publishes it, or stops after the draft with `--draft true`. It writes to your real account. You must be signed in to juejin.cn in the browser chrome-use drives; otherwise it stops before writing anything.

## Commands

```sh
# save a draft only (try this first)
chrome-use site juejin/article-publish --title "My title" --markdown @post.md \
  --summary "One-paragraph summary, 50 to 100 characters" \
  --tags "Claude,AI编程,开源" --category 人工智能 --draft true

# create the draft and publish it
chrome-use site juejin/article-publish --title "My title" --markdown @post.md \
  --summary "One-paragraph summary, 50 to 100 characters" \
  --tags "Claude,AI编程,开源" --category 人工智能
```

`--markdown` takes the whole body as a string; pass a file with `@post.md`, or `@-` for stdin. chrome-use before 1.5.149 needs `--markdown "$(cat post.md)"`.

## Adapters

| adapter | args | returns / does |
| --- | --- | --- |
| `juejin/article-publish` | `--title` (required), `--markdown` (required), `--summary`, `--tags`, `--category`, `--draft` | Creates a draft through `api.juejin.cn` `content_api/v1/article_draft/create` (Markdown in `mark_content`, `edit_type` 10), then publishes it with `content_api/v1/article/publish`. Returns `{ok, id, draft_id, url, status, tags, skipped_tags}` or `{error, hint}`. |

- **Category.** `--category` is a name as the editor shows it (后端 前端 Android iOS 人工智能 开发工具 代码人生 阅读) or a numeric category id. Names are looked up through `tag_api/v1/query_category_list`; an unknown name fails with the list of valid ones. Publishing requires a category; a draft does not.
- **Tags.** Comma-separated (`,` or `，`). Each name is searched with `tag_api/v1/query_tag_list` and used only on an exact match, then a case-insensitive one, never the nearest result. At most 3 are used; the rest, and names Juejin does not have, come back in `skipped_tags`. Publishing needs at least one existing tag.
- **Summary.** Sent as `brief_content`, cut to 100 characters. Juejin rejects a publish whose summary is not 50 to 100 characters. Without `--summary`, the first 100 characters of the body text are used (code blocks, images and Markdown markup removed).
- **Checks before writing.** Missing title or body, not signed in, an unknown category, and (when publishing) no category or no existing tag all stop the run before a draft is created.
- **Result.** With `--draft true`: `status: "draft"`, `id` is the draft id, `url` is `https://juejin.cn/editor/drafts/<id>`. After publishing: `status: "published"`, `id` is the article id, `url` is `https://juejin.cn/post/<id>`. New posts go through Juejin's review before they are public.
- **Publish failed after the draft was saved.** The result has `error`, `status: "draft"` and the draft URL. Do not re-run, which would create a second draft; finish it in the Juejin editor.

One run is one article. Check your article list before posting the same thing again, and delete test drafts afterwards.

## Tests

`node --test juejin/`

The tests run against a stubbed `api.juejin.cn`; nothing goes to the live site.

Same adapter for: [csdn](../csdn/) · [segmentfault](../segmentfault/) · [zhihu](../zhihu/)
See [CHANGELOG](../CHANGELOG.md) for changes.
