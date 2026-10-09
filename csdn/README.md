# `csdn/` — cross-post a Markdown article to CSDN

English · [中文](README.zh.md)

`csdn/article-publish` posts a Markdown article to CSDN as 原创 (original), public, as the signed-in user. It runs on `editor.csdn.net` and saves the article in one request, either published or, with `--draft true`, as a draft. It writes to your real account. You must be signed in to CSDN (passport.csdn.net) in the browser chrome-use drives; otherwise it stops before saving.

## Commands

```sh
# save a draft only (try this first)
chrome-use site csdn/article-publish --title "My title" --markdown @post.md \
  --summary "One-paragraph summary" --tags "Claude,AI编程,人工智能,开源" --draft true

# publish
chrome-use site csdn/article-publish --title "My title" --markdown @post.md \
  --summary "One-paragraph summary" --tags "Claude,AI编程,人工智能,开源"

# publish over an existing article (e.g. a draft the editor autosaved) instead of creating a new one
chrome-use site csdn/article-publish --id 123456789 --title "My title" --markdown @post.md --tags "AI编程"
```

`--markdown` takes the whole body as a string; pass a file with `@post.md`, or `@-` for stdin. chrome-use before 1.5.149 needs `--markdown "$(cat post.md)"`.

## Adapters

| adapter | args | returns / does |
| --- | --- | --- |
| `csdn/article-publish` | `--title` (required), `--markdown` (required), `--summary`, `--tags`, `--category`, `--html`, `--id`, `--draft` | One `POST bizapi.csdn.net/blog-console-api/v3/mdeditor/saveArticle` with `markdowncontent`, the rendered HTML, `type: original`, `readType: public`, and `status` 0 (publish) or 2 (draft). Returns `{ok, id, url, status, tags, skipped_tags}` or `{error, hint}`. |

- **Request signing.** Every `bizapi.csdn.net` call needs CSDN's x-ca-* signature headers. The adapter does not compute them: it finds the editor's own request client in the page bundle and sends through it. chrome-use opens `https://editor.csdn.net/`, which is not the editor, so the adapter loads `editor.csdn.net/md/` in a hidden same-origin frame, borrows the client, and removes the frame afterwards. If the bundle changed and the client cannot be found, it fails with an error saying the adapter needs updating.
- **Title** should be 5 to 100 characters (CSDN's rule; the adapter does not check it).
- **Summary** goes into the 摘要 (`Description`) field, cut to 256 characters. Without it the field is left empty.
- **Tags.** Comma-separated. Each name is searched with CSDN's tag search and used only on an exact match, then a case-insensitive one. At most 5 are used. Accounts below blog level 3 cannot create tags, so names CSDN does not already have come back in `skipped_tags`. Publishing needs at least one existing tag; with none, the run stops before saving.
- **Category.** `--category` is your own 分类专栏 names, comma-separated. Optional.
- **Body HTML.** The adapter renders the Markdown to HTML itself (headings, paragraphs, fenced code, quotes, nested lists, rules, GFM tables, bold/italic/strike, inline code, links, images; raw HTML in the source is escaped). `--html` sends your own HTML instead.
- **`--id`** saves over that existing article (published, or as a draft with `--draft true`) instead of creating a new one.
- **Result.** Draft: `status: "draft"`, `url` is `https://editor.csdn.net/md/?articleId=<id>`. Published: `status: "published"`, `url` is the blog URL CSDN returns (or `https://blog.csdn.net/<user>/article/details/<id>`). CSDN reviews new posts, so one may stay hidden for a few minutes.
- **Refused save.** The result has `error`, `tags` and `skipped_tags`. Check https://mp.csdn.net/mp_blog/manage/article before running again.

One run is one article. Delete test drafts afterwards.

## Tests

`node --test csdn/`

The tests use a stubbed editor client; they also check that the Markdown converter is the same code as in `zhihu/`.

Same adapter for: [juejin](../juejin/) · [segmentfault](../segmentfault/) · [zhihu](../zhihu/)
See [CHANGELOG](../CHANGELOG.md) for changes.
