/* @meta
{
  "name": "segmentfault/article-publish",
  "description": "Publish a Markdown article to SegmentFault (思否) as the signed-in user, or save it as a draft only",
  "domain": "segmentfault.com",
  "args": {
    "title": {"required": true, "description": "Article title"},
    "markdown": {"required": true, "description": "Full Markdown body (pass a file with --markdown @post.md)"},
    "summary": {"required": false, "description": "Ignored: SegmentFault builds the excerpt from the body. Accepted so one command line works for every platform"},
    "tags": {"required": false, "description": "Comma-separated tag names. Only tags SegmentFault already has are used (max 5); the rest come back in skipped_tags. Publishing needs at least one"},
    "type": {"required": false, "description": "原创 (default), 转载 or 翻译"},
    "source_url": {"required": false, "description": "Original URL, required by SegmentFault for 转载 / 翻译"},
    "draft": {"required": false, "description": "true = only save a draft, do not publish (default false)"}
  },
  "capabilities": ["network"],
  "readOnly": false,
  "example": "chrome-use site segmentfault/article-publish --title \"Hello\" --markdown @post.md --tags \"claude,codex,开源\" --draft true"
}
*/

async function(args) {
  args = args || {}
  const title = String(args.title || '').trim()
  const markdown = String(args.markdown || '')
  if (!title) return { error: 'Missing argument: title' }
  if (!markdown.trim()) return { error: 'Missing argument: markdown' }
  const draftOnly = /^(1|true|yes|y|on)$/i.test(String(args.draft || ''))
  const tagNames = String(args.tags || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean)
  const types = { '原创': 1, original: 1, '1': 1, '转载': 2, repost: 2, '2': 2, '翻译': 3, translation: 3, '3': 3 }
  const type = types[String(args.type || '原创').trim().toLowerCase()]
  if (!type) return { error: 'Unknown type: ' + args.type, hint: 'Use 原创, 转载 or 翻译.' }

  // segmentfault.com sends its gateway calls through one Api object (token
  // header, and a signed query string on GETs). Its methods are exported, bound,
  // from the module that defines `saveDraft(m){…"/draft"…}`; resolve the export
  // names from that module's own source and call them, rather than rebuilding
  // the token/signature handling here.
  const api = (() => {
    const chunks = window.webpackChunk_N_E
    if (!chunks || typeof chunks.push !== 'function') return null
    let req = null
    chunks.push([[Symbol('chrome-use-sf')], {}, (r) => { req = r }])
    if (!req || !req.m) return null
    for (const id of Object.keys(req.m)) {
      let src
      try { src = String(req.m[id]) } catch (e) { continue }
      if (!src.includes('saveDraft(') || !src.includes('"/draft"')) continue
      let mod
      try { mod = req(Number(id)) } catch (e) { continue }
      const pick = (method) => {
        const local = src.match(new RegExp('([\\w$]+)=[\\w$]+\\.' + method + '[,;]'))
        if (!local) return null
        const exp = src.match(new RegExp('([\\w$]+):function\\(\\)\\{return ' + local[1].replace(/\$/g, '\\$') + '\\}'))
        const fn = exp && mod[exp[1]]
        return typeof fn === 'function' ? fn : null
      }
      const out = { getUser: pick('getUser'), getTags: pick('getTags'), saveDraft: pick('saveDraft'), postArticle: pick('postArticle') }
      if (Object.values(out).every(Boolean)) return out
    }
    return null
  })()
  if (!api) return { error: 'Cannot find the SegmentFault API client', hint: 'segmentfault.com changed its bundle; this adapter needs updating.' }

  // The client rejects with the response body (or `false`); turn that into text.
  const why = (e) => {
    if (!e) return 'request failed'
    if (typeof e === 'string') return e
    const parts = []
    for (const k of ['message', 'msg', 'title', 'tags', 'text', 'error']) if (e[k] && typeof e[k] === 'string') parts.push(e[k])
    return parts.join('; ') || JSON.stringify(e).slice(0, 300)
  }

  let user = null
  try {
    const r = await api.getUser()
    user = (r && (r.user || (r.data && r.data.user) || r.data)) || null
  } catch (e) {
    user = null
  }
  if (!user || !user.id) {
    const s = window.__NEXT_DATA__ && window.__NEXT_DATA__.props && window.__NEXT_DATA__.props.pageProps
    const g = s && s.initialState && s.initialState.global
    if (!g || !g.sessionInfo || !g.sessionInfo.login) {
      return { error: 'Not signed in to segmentfault.com', hint: 'Log in at https://segmentfault.com/user/login in this browser, then retry.' }
    }
  }

  // Tags: exact name matches from SegmentFault's own tag search.
  const found = await Promise.all(tagNames.map((q) => api.getTags({ query: 'search', q }).catch(() => null)))
  const tags = []
  const usedTags = []
  const skippedTags = []
  tagNames.forEach((name, i) => {
    const rows = (found[i] && found[i].rows) || []
    const hit = rows.find((t) => t.name === name) || rows.find((t) => String(t.name).toLowerCase() === name.toLowerCase())
    if (hit && tags.length < 5 && !tags.includes(hit.id)) {
      tags.push(hit.id)
      usedTags.push(hit.name)
    } else {
      skippedTags.push(name)
    }
  })
  if (!draftOnly && !tags.length) {
    return { error: 'None of the tags exist on SegmentFault: ' + tagNames.join(', '), hint: 'Publishing needs at least one existing tag.' }
  }
  if (!draftOnly && type !== 1 && !args.source_url) return { error: '转载 / 翻译 needs --source_url' }

  // Same fields the /write page autosaves.
  let draft
  try {
    draft = await api.saveDraft({ title, tags, text: markdown, object_id: '', type: 'article', cover: '' })
  } catch (e) {
    return { error: 'Could not save the draft: ' + why(e) }
  }
  const draftId = String((draft && (draft.id || (draft.data && draft.data.id))) || '')
  if (!draftId) return { error: 'SegmentFault saved no draft id', hint: 'The draft API answer changed shape.' }
  const base = { draft_id: draftId, tags: usedTags, skipped_tags: skippedTags }
  if (draftOnly) {
    return Object.assign({ ok: true, id: draftId, url: 'https://segmentfault.com/user/draft', status: 'draft' }, base)
  }

  // …and the fields the publish button adds from the 高级选项 panel.
  let pub
  try {
    pub = await api.postArticle({
      tags,
      title,
      text: markdown,
      draft_id: draftId,
      blog_id: '0',
      type,
      url: type === 1 ? '' : String(args.source_url),
      cover: '',
      license: 0,
      log: '',
    })
  } catch (e) {
    // scene_id means SegmentFault wants a captcha / verification first.
    if (e && e.scene_id) {
      return Object.assign({ error: 'SegmentFault asked for verification before publishing', hint: 'Open https://segmentfault.com/write, finish the check by hand and publish the saved draft there. Do not retry here.', status: 'draft' }, base)
    }
    return Object.assign({ error: 'Draft saved but publish failed: ' + why(e), hint: 'Finish it at https://segmentfault.com/user/draft. Do not re-run: that would create a second draft.', status: 'draft' }, base)
  }
  const aid = String((pub && pub.data && pub.data.id) || (pub && pub.id) || '')
  return Object.assign({
    ok: true,
    id: aid || draftId,
    url: aid ? 'https://segmentfault.com/a/' + aid : 'https://segmentfault.com/user/draft',
    // New accounts' posts wait for manual review; SegmentFault says so in msg.
    status: pub && /审核/.test(String(pub.msg || '')) ? 'in_review' : 'published',
    message: (pub && pub.msg) || undefined,
  }, base)
}
