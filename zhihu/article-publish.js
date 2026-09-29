/* @meta
{
  "name": "zhihu/article-publish",
  "description": "Publish a Markdown article to Zhihu 专栏 (知乎文章) as the signed-in user, or save it as a draft only",
  "domain": "zhuanlan.zhihu.com",
  "args": {
    "title": {"required": true, "description": "Article title"},
    "markdown": {"required": true, "description": "Full Markdown body (pass a file with --markdown \"$(cat post.md)\"); converted to Zhihu's HTML by the adapter"},
    "summary": {"required": false, "description": "Ignored: Zhihu builds the excerpt from the body. Accepted so one command line works for every platform"},
    "tags": {"required": false, "description": "Comma-separated topic (话题) names. Only topics Zhihu already has are bound (max 3); the rest come back in skipped_tags. Publishing needs at least one"},
    "html": {"required": false, "description": "Ready-made HTML body; overrides the markdown conversion"},
    "draft": {"required": false, "description": "true = only save a draft, do not publish (default false)"}
  },
  "capabilities": ["network"],
  "readOnly": false,
  "example": "chrome-use site zhihu/article-publish --title \"Hello\" --markdown \"$(cat post.md)\" --tags \"Claude,AI编程,开源\" --draft true"
}
*/

async function(args) {
  args = args || {}
  const title = String(args.title || '').trim()
  const markdown = String(args.markdown || '')
  if (!title) return { error: 'Missing argument: title' }
  if (!markdown.trim() && !args.html) return { error: 'Missing argument: markdown' }
  const draftOnly = /^(1|true|yes|y|on)$/i.test(String(args.draft || ''))
  const tagNames = String(args.tags || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean)

  // ---- markdown → html (shared verbatim by csdn/ and zhihu/; a test keeps the copies equal)
  // Covers what blog posts use: headings, paragraphs, fenced code, block
  // quotes, flat or nested lists, rules, GFM tables, bold/italic/strike,
  // inline code, links, images. Raw HTML in the source is escaped, not passed.
  const mdToHtml = (src, codeBlock) => {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const inline = (text) => {
      const slots = []
      const keep = (html) => '\u0000' + (slots.push(html) - 1) + '\u0000'
      let s = String(text).replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (m, t, c) => keep('<code>' + esc(c.trim()) + '</code>'))
      s = s.replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (m, alt, url) => keep('<img src="' + esc(url) + '" alt="' + esc(alt) + '">'))
      s = s.replace(/\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (m, label, url) => keep('<a href="' + esc(url) + '">' + inline(label) + '</a>'))
      s = s.replace(/<(https?:\/\/[^\s>]+)>/g, (m, url) => keep('<a href="' + esc(url) + '">' + esc(url) + '</a>'))
      s = esc(s)
      s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>').replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>')
      s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
      s = s.replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*(?!\*)/g, '$1<em>$2</em>')
      s = s.replace(/(^|[^_\w])_(?=\S)([^_]*?\S)_(?![_\w])/g, '$1<em>$2</em>')
      s = s.replace(/ {2,}\n/g, '<br>\n')
      return s.replace(/\u0000(\d+)\u0000/g, (m, i) => slots[Number(i)])
    }
    const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
    const blocks = (lines) => {
      const out = []
      let i = 0
      const isFence = (l) => /^\s{0,3}(```|~~~)/.test(l)
      const isHr = (l) => /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l)
      const isHead = (l) => /^\s{0,3}#{1,6}(\s|$)/.test(l)
      const isQuote = (l) => /^\s{0,3}>/.test(l)
      const isItem = (l) => /^\s{0,3}([-*+]|\d{1,9}[.)])\s+/.test(l)
      const isTable = (k) => /\|/.test(lines[k] || '') && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(lines[k + 1] || '')
      while (i < lines.length) {
        const line = lines[i]
        if (!line.trim()) { i++; continue }
        if (isFence(line)) {
          const fence = line.trim().slice(0, 3)
          const lang = line.trim().slice(3).trim().split(/\s+/)[0] || ''
          const body = []
          i++
          while (i < lines.length && !lines[i].trim().startsWith(fence)) body.push(lines[i++])
          i++
          out.push(codeBlock(lang, esc(body.join('\n'))))
          continue
        }
        if (isHead(line)) {
          const m = line.trim().match(/^(#{1,6})\s*(.*?)\s*#*\s*$/)
          out.push('<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>')
          i++
          continue
        }
        if (isHr(line)) { out.push('<hr>'); i++; continue }
        if (isQuote(line)) {
          const body = []
          while (i < lines.length && lines[i].trim() && isQuote(lines[i])) body.push(lines[i++].replace(/^\s{0,3}>\s?/, ''))
          out.push('<blockquote>' + blocks(body) + '</blockquote>')
          continue
        }
        if (isTable(i)) {
          const head = cells(lines[i])
          i += 2
          const rows = []
          while (i < lines.length && lines[i].trim() && /\|/.test(lines[i])) rows.push(cells(lines[i++]))
          out.push('<table><thead><tr>' + head.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' +
            rows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>')
          continue
        }
        if (isItem(line)) {
          const ordered = /^\s{0,3}\d/.test(line)
          const indent = line.match(/^\s*/)[0].length
          const items = []
          while (i < lines.length) {
            const l = lines[i]
            const ind = l.match(/^\s*/)[0].length
            if (isItem(l) && ind <= indent + 1) {
              if (/^\s{0,3}\d/.test(l) !== ordered) break
              items.push([l.replace(/^\s*([-*+]|\d{1,9}[.)])\s+/, '')])
              i++
            } else if (l.trim() && items.length && (ind > indent || !(isFence(l) || isHead(l) || isQuote(l) || isHr(l)))) {
              items[items.length - 1].push(ind > indent ? l.slice(Math.min(ind, indent + 2)) : l)
              i++
            } else if (!l.trim() && i + 1 < lines.length && lines[i + 1].match(/^\s*/)[0].length > indent && lines[i + 1].trim()) {
              items[items.length - 1].push('')
              i++
            } else break
          }
          const tag = ordered ? 'ol' : 'ul'
          out.push('<' + tag + '>' + items.map((it) => {
            const inner = blocks(it)
            // A tight item is one paragraph: drop its <p> so lists render compact.
            return '<li>' + (/^<p>[\s\S]*<\/p>$/.test(inner) && inner.indexOf('<p>', 1) < 0 ? inner.slice(3, -4) : inner) + '</li>'
          }).join('') + '</' + tag + '>')
          continue
        }
        const para = []
        while (i < lines.length && lines[i].trim() && !isFence(lines[i]) && !isHead(lines[i]) && !isQuote(lines[i]) && !isHr(lines[i]) && !isItem(lines[i]) && !isTable(i)) para.push(lines[i++])
        out.push('<p>' + inline(para.join('\n')) + '</p>')
      }
      return out.join('')
    }
    return blocks(String(src || '').replace(/\r\n?/g, '\n').split('\n'))
  }
  // ---- end markdown → html

  // Zhihu's own fetch wrapper adds the xsrf token and the x-zse signature
  // headers. Find it in the page's webpack registry by a string only that
  // module has, and send every request through it.
  const zfetch = (() => {
    const chunks = window.webpackChunkheifetz
    if (!chunks || typeof chunks.push !== 'function') return null
    let req = null
    chunks.push([[Symbol('chrome-use-zhihu')], {}, (r) => { req = r }])
    if (!req || !req.m) return null
    for (const id of Object.keys(req.m)) {
      let src
      try { src = String(req.m[id]) } catch (e) { continue }
      if (!src.includes('please add fetch polyfill')) continue
      let mod
      try { mod = req(Number(id)) } catch (e) { continue }
      for (const k of Object.keys(mod)) if (typeof mod[k] === 'function') return mod[k]
    }
    return null
  })()
  if (!zfetch) return { error: 'Cannot find the Zhihu fetch client', hint: 'zhuanlan.zhihu.com changed its bundle; this adapter needs updating.' }

  // Resolves to {ok, data} or {ok:false, error, code}; the wrapper rejects with
  // the parsed error body ({error:{message, code}}) plus the HTTP status.
  const call = async (url, method, body, extra) => {
    try {
      const opts = Object.assign({ method: method || 'GET' }, extra || {})
      if (body !== undefined) {
        opts.headers = { 'Content-Type': 'application/json' }
        opts.body = JSON.stringify(body)
      }
      return { ok: true, data: await zfetch(url, opts) }
    } catch (e) {
      const err = (e && (e.error || (e.payload && e.payload.error) || e.payload)) || e || {}
      return { ok: false, status: e && e.status, code: err.code, error: err.message || (e && e.message) || JSON.stringify(e).slice(0, 300) }
    }
  }
  const ZL = 'https://zhuanlan.zhihu.com/api'
  const noSig = { zsAutoSignature: false }

  const me = await call('https://www.zhihu.com/api/v4/me')
  if (!me.ok || !me.data || !me.data.id) return { error: 'Not signed in to zhihu.com', hint: 'Log in at https://www.zhihu.com in this browser, then retry.' }

  // Zhihu articles take h2/h3 only; code blocks go in as <pre lang>, which is
  // what the editor itself produces.
  const content = String(args.html || '') || mdToHtml(markdown, (lang, code) =>
    '<pre lang="' + (lang.replace(/[^\w+#.-]/g, '') || 'text') + '">' + code + '</pre>')
    .replace(/<(\/?)h1>/g, '<$1h2>')
    .replace(/<(\/?)h[4-6]>/g, '<$1h3>')

  // Topics: exact (then case-insensitive) matches from the editor's own
  // topic autocomplete.
  const found = await Promise.all(tagNames.map((q) =>
    call(ZL + '/autocomplete/topics?token=' + encodeURIComponent(q) + '&max_matches=5&use_similar=0&topic_filter=1')))
  const topics = []
  const skippedTags = []
  tagNames.forEach((name, i) => {
    const rows = (found[i].ok && Array.isArray(found[i].data)) ? found[i].data : []
    const hit = rows.find((t) => t.name === name) || rows.find((t) => String(t.name).toLowerCase() === name.toLowerCase())
    if (hit && topics.length < 3 && !topics.some((t) => t.id === hit.id)) topics.push(hit)
    else skippedTags.push(name)
  })
  if (!draftOnly && !topics.length) {
    return { error: 'None of the topics exist on Zhihu: ' + tagNames.join(', '), hint: 'Publishing needs at least one existing topic (话题).' }
  }

  const created = await call(ZL + '/articles/drafts', 'POST', { title, content, table_of_contents: false, delta_time: 0 }, noSig)
  if (!created.ok || !created.data || !created.data.id) return { error: 'Could not create the draft: ' + (created.error || 'no id returned') }
  const id = String(created.data.id)
  const draftUrl = 'https://zhuanlan.zhihu.com/p/' + id + '/edit'
  // The create call can drop fields on some accounts; write them once more.
  const patched = await call(ZL + '/articles/' + id + '/draft', 'PATCH', { title, content, table_of_contents: false, delta_time: 1 }, noSig)
  if (!patched.ok) return { error: 'Draft ' + id + ' created but saving its body failed: ' + patched.error, hint: 'Check ' + draftUrl, id, url: draftUrl, status: 'draft' }

  const usedTags = []
  for (const t of topics) {
    const r = await call(ZL + '/articles/' + id + '/topics', 'POST', t)
    if (r.ok) usedTags.push(t.name)
    else skippedTags.push(t.name + ' (' + r.error + ')')
  }
  const base = { id, tags: usedTags, skipped_tags: skippedTags }
  if (draftOnly) return Object.assign({ ok: true, url: draftUrl, status: 'draft' }, base)
  if (!usedTags.length) return Object.assign({ error: 'Could not bind any topic; not publishing', hint: 'Finish it at ' + draftUrl, url: draftUrl, status: 'draft' }, base)

  // The body the editor's publish button posts (see its PublishPanel): one
  // /api/v4/content/publish call with action "article".
  const settings = {
    commentPermission: 'anyone',
    disclaimer_type: 'none',
    disclaimer_status: 'close',
    table_of_contents_enabled: false,
    content,
    title,
    canReward: false,
    commercial_report_info: { commercial_types: [] },
  }
  const text = content.replace(/<[^>]+>/g, '')
  const data = {
    extra_info: { publisher: 'pc', pc_business_params: JSON.stringify(settings) },
    draft: { disabled: 1, id, isPublished: false },
    commentsPermission: { comment_permission: 'anyone' },
    creationStatement: { disclaimer_type: 'none', disclaimer_status: 'close' },
    contentsTables: { table_of_contents_enabled: false },
    commercialReportInfo: { isReport: 0 },
    appreciate: { can_reward: false, tagline: '' },
    hybridInfo: {},
    hybrid: { html: content, textLength: Array.from(text).length },
    title: { title },
  }
  const pub = await call('https://www.zhihu.com/api/v4/content/publish', 'POST', { action: 'article', data })
  if (!pub.ok) {
    return Object.assign({
      error: 'Draft saved but publish failed: ' + pub.error + (pub.code ? ' (code ' + pub.code + ')' : ''),
      hint: pub.code === 4031
        ? 'Zhihu wants account verification (phone/real-name) first; do it by hand, then publish ' + draftUrl
        : 'Finish it at ' + draftUrl + '. Do not re-run: that would create a second draft.',
      url: draftUrl,
      status: 'draft',
    }, base)
  }
  const p = (pub.data && (pub.data.publish || (pub.data.data && pub.data.data.publish))) || {}
  return Object.assign(base, {
    ok: true,
    url: p.url || 'https://zhuanlan.zhihu.com/p/' + id,
    status: 'published',
  })
}
