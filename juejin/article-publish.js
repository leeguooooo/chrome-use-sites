/* @meta
{
  "name": "juejin/article-publish",
  "description": "Publish a Markdown article to Juejin (掘金) as the signed-in user, or save it as a draft only",
  "domain": "juejin.cn",
  "args": {
    "title": {"required": true, "description": "Article title"},
    "markdown": {"required": true, "description": "Full Markdown body (pass a file with --markdown @post.md)"},
    "summary": {"required": false, "description": "摘要 / brief_content. Juejin wants 50-100 characters to publish; derived from the body when omitted"},
    "tags": {"required": false, "description": "Comma-separated tag names, e.g. \"Claude,AI编程,开源\". Only tags Juejin already has are used (max 3); the rest come back in skipped_tags. Publishing needs at least one"},
    "category": {"required": false, "description": "Category name or id: 后端 前端 Android iOS 人工智能 开发工具 代码人生 阅读. Required to publish"},
    "draft": {"required": false, "description": "true = only create the draft, do not publish (default false)"}
  },
  "capabilities": ["network"],
  "readOnly": false,
  "example": "chrome-use site juejin/article-publish --title \"Hello\" --markdown @post.md --tags \"AI编程,开源\" --category 人工智能 --draft true"
}
*/

async function(args) {
  args = args || {}
  const API = 'https://api.juejin.cn'
  const title = String(args.title || '').trim()
  const markdown = String(args.markdown || '')
  if (!title) return { error: 'Missing argument: title' }
  if (!markdown.trim()) return { error: 'Missing argument: markdown' }
  const draftOnly = /^(1|true|yes|y|on)$/i.test(String(args.draft || ''))
  const tagNames = String(args.tags || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean)

  // One request. The API answers {err_no, err_msg, data}; err_no 0 is success.
  // `body` null means GET.
  const call = async (path, body) => {
    let resp
    try {
      const url = API + path + (path.includes('?') ? '&' : '?') + 'aid=2608'
      resp = await fetch(url, body === null
        ? { credentials: 'include' }
        : {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body || {}),
          })
    } catch (e) {
      return { ok: false, error: 'Network error calling ' + path + ': ' + (e && e.message) }
    }
    let j = null
    try { j = await resp.json() } catch (e) { j = null }
    if (!resp.ok || !j) return { ok: false, status: resp.status, error: 'HTTP ' + resp.status + ' from ' + path }
    if (j.err_no !== 0) return { ok: false, code: j.err_no, error: path + ': ' + (j.err_msg || 'err_no ' + j.err_no) }
    return { ok: true, data: j.data }
  }

  const me = await call('/user_api/v1/user/get', null)
  if (!me.ok || !me.data || !me.data.user_id) {
    return { error: 'Not signed in to juejin.cn', hint: 'Log in at https://juejin.cn in this browser, then retry.' }
  }

  // Category: accept a name (as the editor shows it) or a raw id.
  let categoryId = ''
  const catArg = String(args.category || '').trim()
  if (catArg) {
    if (/^\d{10,}$/.test(catArg)) {
      categoryId = catArg
    } else {
      const cats = await call('/tag_api/v1/query_category_list', {})
      if (!cats.ok) return { error: cats.error }
      const hit = (cats.data || []).find((c) => c.category && c.category.category_name === catArg)
      if (!hit) {
        return {
          error: 'Unknown Juejin category: ' + catArg,
          hint: 'Use one of: ' + (cats.data || []).map((c) => c.category && c.category.category_name).join(' '),
        }
      }
      categoryId = hit.category_id
    }
  }

  // Tags: exact (case-insensitive) matches only, so a typo never tags the
  // article with some unrelated neighbour from the search results.
  const tagIds = []
  const usedTags = []
  const skippedTags = []
  const found = await Promise.all(tagNames.map((name) =>
    call('/tag_api/v1/query_tag_list', { cursor: '0', key_word: name, limit: 10, sort_type: 1 })))
  tagNames.forEach((name, i) => {
    const rows = (found[i].ok && found[i].data) || []
    const hit = rows.find((t) => t.tag && t.tag.tag_name === name) ||
      rows.find((t) => t.tag && String(t.tag.tag_name).toLowerCase() === name.toLowerCase())
    if (hit && tagIds.length < 3 && !tagIds.includes(hit.tag_id)) {
      tagIds.push(hit.tag_id)
      usedTags.push(hit.tag.tag_name)
    } else {
      skippedTags.push(name)
    }
  })

  if (!draftOnly) {
    if (!categoryId) return { error: 'Publishing needs --category', hint: 'e.g. --category 人工智能, or pass --draft true' }
    if (!tagIds.length) return { error: 'None of the tags exist on Juejin: ' + tagNames.join(', '), hint: 'Publishing needs at least one existing tag.' }
  }

  // brief_content: Juejin rejects a publish outside 50-100 characters.
  let brief = String(args.summary || '').trim()
  if (!brief) {
    brief = markdown
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#>*_`~|-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }
  brief = Array.from(brief).slice(0, 100).join('')

  const created = await call('/content_api/v1/article_draft/create', {
    category_id: categoryId || '0',
    tag_ids: tagIds,
    link_url: '',
    cover_image: '',
    title,
    brief_content: brief,
    edit_type: 10,
    html_content: 'deprecated',
    mark_content: markdown,
    theme_ids: [],
  })
  if (!created.ok) return { error: 'Could not create the draft: ' + created.error }
  const draftId = created.data && (created.data.id || created.data.draft_id)
  if (!draftId) return { error: 'Juejin created no draft id', hint: 'The draft API answer changed shape.' }
  const draftUrl = 'https://juejin.cn/editor/drafts/' + draftId
  const base = { id: String(draftId), draft_id: String(draftId), tags: usedTags, skipped_tags: skippedTags }

  if (draftOnly) return Object.assign({ ok: true, url: draftUrl, status: 'draft' }, base)

  const pub = await call('/content_api/v1/article/publish', {
    draft_id: String(draftId),
    sync_to_org: false,
    column_ids: [],
    theme_ids: [],
  })
  if (!pub.ok) {
    return Object.assign({
      error: 'Draft saved but publish failed: ' + pub.error,
      hint: 'Finish it by hand at ' + draftUrl + '. Do not re-run: that would create a second draft.',
      url: draftUrl,
      status: 'draft',
    }, base)
  }
  const articleId = String((pub.data && pub.data.article_id) || '')
  return Object.assign(base, {
    ok: true,
    id: articleId || String(draftId),
    url: articleId ? 'https://juejin.cn/post/' + articleId : draftUrl,
    // New posts go through Juejin's review before they are public.
    status: 'published',
  })
}
