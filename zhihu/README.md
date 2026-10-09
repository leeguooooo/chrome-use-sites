# `zhihu/` — cross-post a Markdown article to a Zhihu column (知乎专栏)

English · [中文](README.zh.md)

`zhihu/article-publish` posts a Markdown article to Zhihu as a 专栏 article (`zhuanlan.zhihu.com`), as the signed-in user. It creates a draft, binds topics (话题), and then publishes it, or stops after the draft with `--draft true`. It writes to your real account. You must be signed in to zhihu.com in the browser chrome-use drives; otherwise it stops before writing anything.

## Commands

```sh
# save a draft only (try this first)
chrome-use site zhihu/article-publish --title "My title" --markdown @post.md \
  --tags "Claude,AI编程,开源" --draft true

# create the draft and publish it
chrome-use site zhihu/article-publish --title "My title" --markdown @post.md \
  --tags "Claude,AI编程,开源"

# send your own HTML instead of converting the Markdown
chrome-use site zhihu/article-publish --title "My title" --html @post.html --tags "开源"
```

`--markdown` takes the whole body as a string; pass a file with `@post.md`, or `@-` for stdin. chrome-use before 1.5.149 needs `--markdown "$(cat post.md)"`.

## Adapters

| adapter | args | returns / does |
| --- | --- | --- |
| `zhihu/article-publish` | `--title` (required), `--markdown` (required unless `--html`), `--tags`, `--html`, `--draft`, `--summary` (ignored) | `POST zhuanlan.zhihu.com/api/articles/drafts`, then `PATCH …/articles/<id>/draft` with the body again, binds each topic with `POST …/articles/<id>/topics`, then publishes with `POST www.zhihu.com/api/v4/content/publish` (`action: "article"`). Returns `{ok, id, url, status, tags, skipped_tags}` or `{error, hint}`. |

- **Requests.** Every call goes through Zhihu's own fetch wrapper, found in the page bundle, which adds the xsrf token and the x-zse signature headers. If the bundle changed and the wrapper cannot be found, the run fails with an error saying the adapter needs updating.
- **Body.** The adapter converts the Markdown to Zhihu's HTML: Zhihu articles take only h2/h3, so `#` becomes h2 and `####` to `######` become h3; fenced code becomes `<pre lang="…">`, as the editor itself produces. Paragraphs, quotes, nested lists, rules, GFM tables, bold/italic/strike, inline code, links and images are converted too; raw HTML in the source is escaped. `--html` sends ready-made HTML instead and skips the conversion. `--summary` is accepted and ignored (Zhihu builds the excerpt from the body), so one command line works for every platform.
- **Topics.** `--tags` are topic (话题) names, comma-separated. Each is looked up with the editor's topic autocomplete (`autocomplete/topics`) and used only on an exact match, then a case-insensitive one. At most 3 are bound; the rest come back in `skipped_tags`, and a topic Zhihu refuses to bind is listed there with its error. Publishing needs at least one existing topic: with none found the run stops before a draft is created, and if none could be bound it stops with the draft kept.
- **Result.** Draft: `status: "draft"`, `url` is `https://zhuanlan.zhihu.com/p/<id>/edit`. Published: `status: "published"`, `url` is the article URL Zhihu returns (or `https://zhuanlan.zhihu.com/p/<id>`).
- **Account verification.** If the publish fails with code 4031, Zhihu wants phone or real-name verification first. Do it by hand, then publish the draft from its edit URL. The adapter never works around such checks.
- **Publish failed after the draft was saved.** The result has `error`, `status: "draft"` and the draft URL. Do not re-run, which would create a second draft; finish it in the Zhihu editor.

One run is one article. Delete test drafts afterwards.

## Tests

`node --test zhihu/`

The tests use a stubbed page and fetch wrapper; nothing goes to the live site.

Same adapter for: [juejin](../juejin/) · [csdn](../csdn/) · [segmentfault](../segmentfault/)
See [CHANGELOG](../CHANGELOG.md) for changes.
