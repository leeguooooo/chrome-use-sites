/* @meta
{
  "name": "csdn/article-publish",
  "description": "Publish a Markdown article to CSDN (as 原创) as the signed-in user, or save it as a draft only",
  "domain": "editor.csdn.net",
  "args": {
    "title": {"required": true, "description": "Article title (CSDN wants 5-100 characters)"},
    "markdown": {"required": true, "description": "Full Markdown body (pass a file with --markdown \"$(cat post.md)\")"},
    "summary": {"required": false, "description": "摘要 (Description), up to 256 characters"},
    "tags": {"required": false, "description": "Comma-separated tag names. Only tags CSDN already has are used (max 5); accounts below blog level 3 cannot create tags, so the rest come back in skipped_tags. Publishing needs at least one"},
    "category": {"required": false, "description": "Your own 分类专栏 names, comma-separated (optional)"},
    "html": {"required": false, "description": "Rendered HTML for the body. Default: converted from markdown by the adapter"},
    "draft": {"required": false, "description": "true = only save a draft, do not publish (default false)"},
    "id": {"required": false, "description": "Existing article id to overwrite and publish (e.g. a draft the editor autosaved), instead of creating a new article"}
  },
  "capabilities": ["network"],
  "readOnly": false,
  "example": "chrome-use site csdn/article-publish --title \"Hello\" --markdown \"$(cat post.md)\" --summary \"...\" --tags \"AI编程,人工智能,开源\" --draft true"
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

  // Every bizapi.csdn.net call carries x-ca-key / x-ca-nonce / x-ca-signature
  // headers. The editor signs them in its own request client; find that client
  // in the editor's webpack registry (through the module that saves articles)
  // and send through it, instead of re-implementing the signature here.
  const findClient = (win) => {
    const chunks = win && win.webpackChunkcsdnEdit
    if (!chunks || typeof chunks.push !== 'function') return null
    let req = null
    chunks.push([[Symbol('chrome-use-csdn')], {}, (r) => { req = r }])
    if (!req || !req.m) return null
    for (const id of Object.keys(req.m)) {
      let src
      try { src = String(req.m[id]) } catch (e) { continue }
      if (!src.includes('mdeditor/saveArticle')) continue
      const m = src.match(/(\w+)=\w\((\d+)\)[^]*?\b\1\.(\w+)\.request\(\{method:"POST",url:"".concat\("https:\/\/bizapi\.csdn\.net\/blog-console-api\/","v3\/mdeditor\/saveArticle"/)
      if (!m) continue
      let client = null
      try { client = req(Number(m[2]))[m[3]] } catch (e) { client = null }
      if (client && typeof client.request === 'function') return client
    }
    return null
  }
  if (!/(^|\.)editor\.csdn\.net$/.test(location.hostname)) {
    return { error: 'Not on editor.csdn.net', hint: 'Run it through `chrome-use site`, which opens editor.csdn.net first.' }
  }
  // chrome-use lands on https://editor.csdn.net/, which is not the editor. Load
  // the editor (/md/) in a hidden same-origin frame and borrow its client; if
  // this tab already is the editor, use it directly.
  let client = findClient(window)
  let frame = null
  if (!client) {
    frame = document.createElement('iframe')
    frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10px;top:-10px;opacity:0;border:0'
    frame.src = 'https://editor.csdn.net/md/?not_checkout=1'
    document.body.appendChild(frame)
    for (let n = 0; n < 40 && !client; n++) {
      await new Promise((r) => setTimeout(r, 150))
      try { client = findClient(frame.contentWindow) } catch (e) { client = null }
    }
  }
  if (!client) {
    if (frame) frame.remove()
    return { error: 'Cannot find the CSDN editor request client', hint: 'editor.csdn.net/md/ did not load or changed its bundle; this adapter needs updating.' }
  }
  try {
    return await publish()
  } finally {
    if (frame) frame.remove()
  }

  async function publish() {
    const send = async (config) => {
      try {
        const r = await client.request(Object.assign({ withCredentials: true }, config), false, false)
        const body = r && r.body
        if (!body || body.code !== 200) return { ok: false, body, error: (body && (body.msg || body.message)) || 'HTTP ' + (r && r.status) }
        return { ok: true, data: body.data }
      } catch (e) {
        const body = e && e.body
        return { ok: false, body, error: (body && (body.msg || body.message)) || (e && e.message) || String(e) }
      }
    }

    const info = await send({ method: 'GET', url: 'https://bizapi.csdn.net/blog-console-api/v3/editor/getBaseInfo' })
    if (!info.ok) return { error: 'Not signed in to CSDN (' + info.error + ')', hint: 'Log in at https://passport.csdn.net in this browser, then retry.' }
    const user = info.data || {}

    // Tags: exact (case-insensitive) matches from CSDN's own tag search.
    const found = await Promise.all(tagNames.map((name) => send({
      method: 'POST',
      url: 'https://bizapi.csdn.net/blog/phoenix/console/v1/tag/search-recommend-tag',
      body: { key: name, page: 0, page_size: 50, platform: 'pc' },
    })))
    const usedTags = []
    const skippedTags = []
    tagNames.forEach((name, i) => {
      const rows = (found[i].ok && Array.isArray(found[i].data)) ? found[i].data : []
      const hit = rows.find((t) => String(t) === name) || rows.find((t) => String(t).toLowerCase() === name.toLowerCase())
      if (hit && usedTags.length < 5 && !usedTags.includes(hit)) usedTags.push(hit)
      else skippedTags.push(name)
    })
    if (!draftOnly && !usedTags.length) {
      return { error: 'None of the tags exist on CSDN: ' + tagNames.join(', '), hint: 'Publishing needs at least one existing tag; this account (blog level ' + user.blog_level + ') cannot create new ones.' }
    }

    const content = String(args.html || '') || mdToHtml(markdown, (lang, code) =>
      '<pre><code' + (lang ? ' class="prism language-' + lang.replace(/[^\w+#.-]/g, '') + '"' : '') + '>' + code + '</code></pre>')

    // Field for field what the editor's own publish sends (status 0 = publish,
    // 2 = draft; type original = 原创).
    const saved = await send({
      method: 'POST',
      url: 'https://bizapi.csdn.net/blog-console-api/v3/mdeditor/saveArticle',
      body: {
        id: /^\d+$/.test(String(args.id || '').trim()) ? String(args.id).trim() : '',
        title,
        markdowncontent: markdown,
        content,
        readType: 'public',
        level: 0,
        tags: usedTags.join(','),
        status: draftOnly ? 2 : 0,
        categories: String(args.category || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean).join(','),
        type: 'original',
        original_link: '',
        authorized_status: false,
        Description: Array.from(String(args.summary || '')).slice(0, 256).join(''),
        resource_url: '',
        not_auto_saved: '1',
        source: 'pc_mdeditor',
        cover_images: [],
        cover_type: 0,
        is_new: 1,
        vote_id: 0,
        resource_id: '',
        pubStatus: draftOnly ? 'draft' : 'publish',
        creation_statement: 0,
      },
    })
    if (!saved.ok) {
      return {
        error: 'CSDN refused the ' + (draftOnly ? 'draft' : 'publish') + ': ' + saved.error,
        hint: 'Nothing to retry blindly: check https://mp.csdn.net/mp_blog/manage/article first.',
        tags: usedTags,
        skipped_tags: skippedTags,
      }
    }
    const d = saved.data || {}
    const id = String(d.article_id || d.id || '')
    return {
      ok: true,
      id,
      url: draftOnly
        ? 'https://editor.csdn.net/md/?articleId=' + id
        : d.url || 'https://blog.csdn.net/' + (user.name || '') + '/article/details/' + id,
      // CSDN reviews new posts; it may stay hidden for a few minutes.
      status: draftOnly ? 'draft' : 'published',
      tags: usedTags,
      skipped_tags: skippedTags,
    }
  }
}
