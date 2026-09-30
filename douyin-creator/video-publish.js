/* @meta
{
  "name": "douyin-creator/video-publish",
  "description": "Upload a local video (--video), fill in and publish (or save as a draft) on Douyin's creator center. One command with --until-done; without --video it fills in a video already uploaded on the upload page",
  "timeout": 600,
  "retryStatuses": ["incomplete", "uploading", "upload_started"],
  "domain": "creator.douyin.com",
  "args": {
    "video": {"required": false, "type": "file", "input": "input[type=file]", "description": "Local video file to upload (needs chrome-use 1.5.149+). The adapter opens the upload page and hands the file to it; use with --until-done, since Douyin navigates to the post page once the upload starts"},
    "title": {"required": false, "description": "作品标题, at most 30 characters. Required unless --video_url is given"},
    "description": {"required": false, "description": "作品简介, at most 1000 characters. Newlines start new lines"},
    "topics": {"required": false, "description": "Comma-separated topic names without #, e.g. \"AI编程,ClaudeCode\". Only topics Douyin already has (exact name, then case-insensitive) are added; the rest come back in skipped_topics"},
    "declaration": {"required": false, "description": "自主声明: ai | opinion | repost | promo | fiction | none. repost is declared as 取材站外. Omit to leave it unset"},
    "visibility": {"required": false, "description": "public (default) | friends | private"},
    "draft": {"required": false, "description": "true = click 暂存离开 (save a draft) instead of 发布 (default false)"},
    "video_url": {"required": false, "description": "Upload page only: fetch this https URL in the page and hand it to the upload input. The host must send CORS headers; GitHub release assets do not. Run again without it once the page is on /content/post/video"}
  },
  "capabilities": ["dom"],
  "readOnly": false,
  "example": "chrome-use site douyin-creator/video-publish --video ./clip.mp4 --title \"Hello\" --description @desc.txt --topics \"AI编程,ClaudeCode\" --declaration ai --visibility private --draft true --until-done"
}
*/

async function(args) {
  args = args || {}
  const W = window
  const D = document
  // Every wait below draws on this budget, and the run stops at a safe point
  // with status "incomplete" instead of being cut off mid-click. chrome-use
  // 1.5.149+ says how long the run has (args.budgetMs); older versions abandon
  // an evaluation after ~8 s.
  const START = Date.now()
  const BUDGET_MS = args.budgetMs > 0 ? Math.max(7000, args.budgetMs - 2000) : 7000
  const left = () => BUDGET_MS - (Date.now() - START)
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const truthy = (v) => /^(1|true|yes|y|on)$/i.test(String(v == null ? '' : v).trim())
  const chars = (s) => Array.from(String(s || '')).length
  const clean = (s) => String(s == null ? '' : s).replace(/[\u200b\u00a0]/g, ' ').replace(/\s+/g, ' ').trim()
  const text = (el) => clean(el && el.textContent)
  const all = (sel, root) => Array.from((root || D).querySelectorAll(sel))

  const DECLARATIONS = {
    ai: '内容由AI生成',
    opinion: '内容为个人观点或见解',
    repost: '内容为转载信息',
    promo: '内容含营销推广信息',
    fiction: '虚构演绎，仅供娱乐',
    none: '无需添加自主声明',
  }
  const VISIBILITY = { public: '公开', friends: '好友可见', private: '仅自己可见' }
  const UPLOAD_URL = 'https://creator.douyin.com/creator-micro/content/upload'
  const path = String(W.location.pathname || '')
  const onUpload = /\/content\/upload/.test(path)
  const onPost = /\/content\/post\/video/.test(path)

  const waitFor = async (fn, ms, step) => {
    const until = Date.now() + Math.max(0, Math.min(ms, left()))
    for (;;) {
      const v = fn()
      if (v) return v
      if (Date.now() >= until) return null
      await sleep(step || 80)
    }
  }
  const click = (el) => {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      el.dispatchEvent(new W.MouseEvent(type, { bubbles: true, cancelable: true, view: W }))
    }
    el.click()
  }
  const captcha = () =>
    all('iframe').some((f) => /captcha|verify/i.test(f.getAttribute('src') || '')) ||
    all('[id*="captcha"], [class*="captcha"], [class*="verify-bar"], [class*="secsdk"]').some((e) => text(e)) ||
    all('.semi-modal, [role="dialog"]').some((m) => /安全验证|滑动|验证码|身份验证|短信验证/.test(text(m)))
  const CAPTCHA = {
    error: 'Douyin is asking for a verification (captcha / SMS)',
    hint: 'Stop here and clear it by hand in the browser. Do not re-run in a loop.',
  }

  // ---- step (a'): --video_url on the upload page ---------------------------
  if (args.video_url) {
    if (!onUpload) {
      return {
        error: onPost ? 'A video is already uploaded on this page' : 'Not on the upload page',
        hint: onPost
          ? 'Drop --video_url and run again to fill in and publish it.'
          : 'chrome-use open https://creator.douyin.com/creator-micro/content/upload, then retry.',
      }
    }
    const src = String(args.video_url)
    if (!/^https:\/\//i.test(src)) return { error: '--video_url must be an https URL' }
    const input = all('input[type="file"]').find((i) => /video|\.mp4/i.test(i.getAttribute('accept') || ''))
    if (!input) return { error: 'No video file input on the upload page', hint: 'The upload page changed; upload with chrome-use upload instead.' }
    let blob
    try {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null
      const timer = ctl ? setTimeout(() => ctl.abort(), Math.max(500, left() - 800)) : null
      const resp = await fetch(src, ctl ? { signal: ctl.signal } : {})
      if (timer) clearTimeout(timer)
      if (!resp.ok) return { error: 'HTTP ' + resp.status + ' fetching ' + src }
      blob = await resp.blob()
    } catch (e) {
      return {
        error: 'Could not fetch ' + src + ' from the page: ' + ((e && e.message) || e),
        hint: 'The host must allow CORS (GitHub release assets do not) and the file must download in a few seconds. ' +
          'Otherwise: chrome-use upload \'input[type=file]\' ./video.mp4',
      }
    }
    const name = decodeURIComponent((src.split('?')[0].split('/').pop() || 'video.mp4')) || 'video.mp4'
    const file = new W.File([blob], /\.\w{2,4}$/.test(name) ? name : name + '.mp4', { type: blob.type && /^video\//.test(blob.type) ? blob.type : 'video/mp4' })
    const dt = new W.DataTransfer()
    dt.items.add(file)
    input.files = dt.files
    input.dispatchEvent(new W.Event('input', { bubbles: true }))
    input.dispatchEvent(new W.Event('change', { bubbles: true }))
    return {
      ok: true,
      status: 'upload_started',
      file: file.name,
      size: file.size,
      hint: 'The page moves to /content/post/video. Run the same command again without --video_url to fill it in.',
    }
  }

  // ---- argument checks (before touching the page) ---------------------------
  const title = String(args.title == null ? '' : args.title).trim()
  if (!title) return { error: 'Missing argument: title' }
  if (chars(title) > 30) return { error: 'Title is ' + chars(title) + ' characters; Douyin allows 30', hint: 'Shorten --title.' }
  const description = String(args.description == null ? '' : args.description).replace(/\r\n?/g, '\n').replace(/\s+$/, '')
  if (chars(description) > 1000) return { error: 'Description is ' + chars(description) + ' characters; Douyin allows 1000' }
  const topicNames = []
  for (const t of String(args.topics || '').split(/[,，]/)) {
    const n = t.trim().replace(/^#+/, '').trim()
    if (n && !topicNames.some((x) => x.toLowerCase() === n.toLowerCase())) topicNames.push(n)
  }
  const declKey = String(args.declaration == null ? '' : args.declaration).trim().toLowerCase()
  if (declKey && !DECLARATIONS[declKey]) {
    return { error: 'Unknown declaration: ' + args.declaration, hint: 'Use one of: ' + Object.keys(DECLARATIONS).join(' ') }
  }
  const visKey = String(args.visibility == null || args.visibility === '' ? 'public' : args.visibility).trim().toLowerCase()
  if (!VISIBILITY[visKey]) return { error: 'Unknown visibility: ' + args.visibility, hint: 'Use public, friends or private.' }
  const draft = truthy(args.draft)

  // --video is a local file chrome-use hands over: {path, name, size, setOn}.
  // An older chrome-use passes the path as a plain string and cannot attach it.
  const localFile = args.video && typeof args.video === 'object' && typeof args.video.setOn === 'function' ? args.video : null
  if (args.video && !localFile) {
    return {
      error: '--video needs chrome-use 1.5.149 or newer',
      hint: 'Run chrome-use upgrade. Or upload first: chrome-use upload \'input[type=file]\' ./video.mp4, then run this without --video.',
    }
  }
  const progress = (m) => { if (typeof args.progress === 'function') args.progress(m) }
  // With --until-done a run that is lost right after the final click (the page
  // navigating away) is run again, and that rerun no longer sees the form. It
  // must not upload the same file a second time and publish it twice.
  const fileStamp = localFile ? localFile.name + '|' + localFile.size : ''
  const PUB_MARK = 'cu-douyin-published'
  const markPublishClick = () => {
    if (!localFile) return
    try { W.sessionStorage.setItem(PUB_MARK, JSON.stringify({ file: fileStamp, at: Date.now() })) } catch (_) {}
  }
  const publishClickedRecently = () => {
    try {
      const m = JSON.parse(W.sessionStorage.getItem(PUB_MARK) || 'null')
      return m && m.file === fileStamp && Date.now() - m.at < 900000 ? m : null
    } catch (_) { return null }
  }
  const ALREADY_CLICKED = (m) => ({
    ok: false,
    status: 'publish_clicked',
    hint: 'A run in this tab already clicked publish for ' + localFile.name + ' ' + Math.round((Date.now() - m.at) / 1000) +
      ' s ago, so the file is not uploaded again. Check the content page. To publish the same file again, use a new tab.',
  })

  if (!onPost) {
    if (/login|passport/.test(W.location.href) || all('input[type="file"]').length === 0 && /登录|扫码/.test(text(D.body).slice(0, 400))) {
      return { error: 'Not signed in to creator.douyin.com', hint: 'Log in at https://creator.douyin.com in this browser, then retry.' }
    }
    if (localFile) {
      const RERUN = 'Run the same command again to continue (--until-done does it for you).'
      const clicked = publishClickedRecently()
      if (clicked) return ALREADY_CLICKED(clicked)
      if (!onUpload) {
        progress('opening the upload page')
        W.location.href = UPLOAD_URL
        return { ok: true, status: 'incomplete', step: 'open-upload', hint: RERUN }
      }
      if (captcha()) return CAPTCHA
      // Douyin moves to /content/post/video once the upload starts. A rerun
      // that still lands here must wait for that, not hand the file over twice.
      const MARK = 'cu-douyin-upload'
      let prev = null
      try { prev = JSON.parse(W.sessionStorage.getItem(MARK) || 'null') } catch (_) { prev = null }
      if (!(prev && prev.file === fileStamp && Date.now() - prev.at < 120000)) {
        const input = await waitFor(() => all('input[type="file"]').find((i) => /video|\.mp4/i.test(i.getAttribute('accept') || '')), 5000)
        if (!input) return { error: 'No video file input on the upload page', hint: 'The upload page changed; upload with chrome-use upload instead.' }
        input.setAttribute('data-cu-file', 'video')
        progress('uploading ' + localFile.name)
        try {
          await localFile.setOn('input[data-cu-file="video"]')
        } catch (e) {
          return { error: 'Could not attach ' + localFile.name + ': ' + ((e && e.message) || e) }
        }
        try { W.sessionStorage.setItem(MARK, JSON.stringify({ file: fileStamp, at: Date.now() })) } catch (_) {}
      }
      // The navigation ends this run; if it is slow, say so and let the rerun pick it up.
      await waitFor(() => false, 4000, 200)
      return { ok: true, status: 'incomplete', step: 'upload', file: localFile.name, size: localFile.size, hint: 'The upload started and the page moves to /content/post/video. ' + RERUN }
    }
    return {
      error: onUpload ? 'No video uploaded yet' : 'Not on the video post page (' + path + ')',
      hint: 'First: chrome-use open https://creator.douyin.com/creator-micro/content/upload && ' +
        'chrome-use upload \'input[type=file]\' ./video.mp4, then run this again. With chrome-use 1.5.149+ pass --video ./video.mp4 --until-done instead.',
    }
  }
  if (captcha()) return CAPTCHA

  // ---- upload state ---------------------------------------------------------
  // The post page keeps the uploader component alive; its React state says
  // uploadStatus 0 idle, 1 uploading, 2 done, -1 failed. The "上传成功" text is
  // only a toast, so it is not a usable marker.
  const uploaderState = () => {
    const seen = new Set()
    const els = all('body *')
    for (let i = 0; i < els.length && i < 4000; i++) {
      const el = els[i]
      const key = Object.keys(el).find((k) => k.indexOf('__reactFiber$') === 0)
      if (!key) continue
      for (let f = el[key]; f && !seen.has(f); f = f.return) {
        seen.add(f)
        const u = f.memoizedProps && f.memoizedProps.uploader
        if (u && u.state && typeof u.state.uploadStatus === 'number') return u.state
      }
    }
    return null
  }
  const upload = () => {
    const st = uploaderState()
    if (st) {
      const code = st.uploadStatus
      return {
        state: code === 2 ? 'done' : code === 1 ? 'uploading' : code === -1 ? 'failed' : 'idle',
        percent: typeof st.uploadPercent === 'number' ? st.uploadPercent : null,
        source: 'react',
      }
    }
    // Fallback when the component moved: read the preview panel.
    const panel = D.querySelector('[class*="content-right"]') || D.body
    const t = text(panel)
    if (/上传失败/.test(t)) return { state: 'failed', percent: null, source: 'dom' }
    const m = t.match(/上传中[^0-9]{0,6}(\d{1,3})%|(\d{1,3})%/)
    if (/上传中|取消上传|剩余时间/.test(t)) return { state: 'uploading', percent: m ? Number(m[1] || m[2]) : null, source: 'dom' }
    if (/重新上传/.test(t)) return { state: 'done', percent: 100, source: 'dom' }
    return { state: 'unknown', percent: null, source: 'dom' }
  }
  let up = upload()
  if (up.state === 'uploading' || up.state === 'unknown') {
    up = (await waitFor(() => { const u = upload(); return u.state === 'done' || u.state === 'failed' ? u : null }, 2000, 200)) || upload()
  }
  if (up.state === 'failed') return { error: 'The video upload failed', hint: 'Click 重新上传 on the page (or upload again), then re-run.' }
  if (up.state !== 'done') {
    return {
      ok: false,
      status: 'uploading',
      upload_percent: up.percent,
      hint: 'The video is still uploading. Nothing was filled in yet; run the same command again in a little while.',
    }
  }

  const done = []
  const warnings = []
  const incomplete = (step) => ({
    ok: false,
    status: 'incomplete',
    stopped_at: step,
    done,
    hint: 'Ran out of time inside chrome-use\'s 8 s window. Every step is idempotent: run the same command again and it continues. Nothing was published.',
  })

  // ---- title ----------------------------------------------------------------
  const titleInput = D.querySelector('input[placeholder*="作品标题"]')
  if (!titleInput) return { error: 'Title input not found', hint: 'The post page changed; this adapter needs updating.' }
  if (titleInput.value !== title) {
    titleInput.focus()
    const setter = Object.getOwnPropertyDescriptor(W.HTMLInputElement.prototype, 'value').set
    setter.call(titleInput, title)
    titleInput.dispatchEvent(new W.InputEvent('input', { bubbles: true, inputType: 'insertText', data: title }))
    titleInput.dispatchEvent(new W.Event('change', { bubbles: true }))
    await sleep(60)
    if (titleInput.value !== title) return { error: 'The title field did not take the value', hint: 'Fill it by hand: chrome-use fill \'[placeholder*="作品标题"]\' "<title>"' }
  }
  done.push('title')

  // ---- description + topics (one contenteditable) --------------------------
  const editor = D.querySelector('.editor-kit-container[contenteditable="true"]') || D.querySelector('.editor-kit-container')
  if (!editor) return { error: 'Description editor not found', hint: 'The post page changed; this adapter needs updating.' }
  const chips = () => all('[data-mention="#"]', editor).map((c) => text(c).replace(/^#/, ''))
  // Plain text per line, topic chips left out.
  const plainText = () =>
    all('.ace-line', editor).map((line) => {
      const copy = line.cloneNode(true)
      for (const c of all('[data-mention]', copy)) c.remove()
      return String(copy.textContent || '').replace(/[\u200b]/g, '').replace(/\u00a0/g, ' ').replace(/\s+$/, '').replace(/^\s+/, '')
    }).join('\n').replace(/\n+$/, '')
  // The editor keeps its own selection model and syncs it from the DOM on
  // `selectionchange`, which fires asynchronously. Typing right after moving
  // the caret inserts at the editor's stale position and scrambles the text
  // (seen live: "#AI编程" came out as a copy of the first five characters).
  // So: caret inside the last text leaf, then yield before any edit.
  const caretToEnd = async () => {
    editor.focus()
    const lines = all('.ace-line', editor)
    const line = lines[lines.length - 1] || editor
    const strings = all('[data-string="true"]', line)
    const leaf = strings.filter((e) => !e.hasAttribute('data-enter')).pop()
    const r = D.createRange()
    if (leaf && leaf.firstChild) r.setStart(leaf.firstChild, leaf.firstChild.length)
    else if (strings.length) r.setStart(strings[strings.length - 1].firstChild || strings[strings.length - 1], 0)
    else r.selectNodeContents(editor)
    r.collapse(!leaf && !strings.length ? false : true)
    const sel = W.getSelection()
    sel.removeAllRanges()
    sel.addRange(r)
    await sleep(60)
  }
  const tailText = () => String(editor.textContent || '').replace(/\u200b/g, '').replace(/\u00a0/g, ' ')
  const isEmpty = () => !clean(editor.textContent)
  const backspace = () => D.execCommand('delete')
  const enter = () =>
    editor.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }))

  if (plainText() !== description.split('\n').map((l) => l.trim()).join('\n')) {
    await caretToEnd()
    if (!isEmpty()) {
      // Replace whatever is there (an earlier attempt, the page's own draft).
      const cap = chars(editor.textContent) + 50
      for (let i = 0; i < cap && !isEmpty(); i++) {
        backspace()
        if (i % 20 === 19) await sleep(0)
      }
      await sleep(80)
      if (!isEmpty()) return { error: 'Could not clear the existing description', hint: 'Clear 作品简介 by hand and re-run.' }
    }
    const lines = description.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) { enter(); await sleep(60) }
      if (lines[i].trim()) { D.execCommand('insertText', false, lines[i].trim()); await sleep(30) }
    }
    await sleep(80)
  }
  done.push('description')

  const topics = []
  const skipped = []
  const suggestionItems = () =>
    all('[class*="mention-suggest-item-container"] [class*="tag-hash-view-name"]').map((nameEl) => {
      const item = nameEl.closest('[class*="tag-hash"]:not([class*="tag-hash-view"])')
      const countEl = item && item.querySelector('[class*="tag-hash-view-count"]')
      return { name: text(nameEl), count: text(countEl), el: item || nameEl }
    })
  for (const name of topicNames) {
    if (chips().some((c) => c.toLowerCase() === name.toLowerCase())) {
      topics.push(chips().find((c) => c.toLowerCase() === name.toLowerCase()))
      continue
    }
    if (left() < 2200) return incomplete('topics')
    await caretToEnd()
    const spaced = /\S$/.test(tailText())
    const typed = (spaced ? ' ' : '') + '#' + name
    D.execCommand('insertText', false, typed)
    // Wait for the list for THIS query (the previous one can linger a tick).
    const items = await waitFor(() => {
      const list = suggestionItems()
      return list.length && list.some((it) => it.name.toLowerCase().indexOf(name.toLowerCase().slice(0, 2)) === 0) ? list : null
    }, 1800, 100)
    const list = items || []
    // A count of "0" is Douyin offering to create a brand-new topic.
    const exists = (it) => it.count && it.count !== '0'
    const hit = list.find((it) => it.name === name && exists(it)) ||
      list.find((it) => it.name.toLowerCase() === name.toLowerCase() && exists(it))
    if (hit) {
      const n0 = chips().length
      click(hit.el)
      const ok = await waitFor(() => chips().length > n0, 1000, 60)
      if (ok) {
        topics.push(hit.name)
        continue
      }
    }
    // Not an existing topic: take the typed text back out, but only if it is
    // still the tail of the editor (never backspace into anything else).
    await caretToEnd()
    if (tailText().replace(/\s+$/, '').endsWith(typed.trim())) {
      for (let i = 0; i < chars(typed); i++) backspace()
    } else {
      warnings.push('Could not remove the unmatched topic text "#' + name + '"; check 作品简介 before publishing')
    }
    D.body.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
    skipped.push(name)
    await sleep(50)
  }
  done.push('topics')

  // ---- 自主声明 ---------------------------------------------------------------
  // Find the row by its label, then the clickable select box inside it.
  const rowByLabel = (label, want) => {
    const labels = all('div, span, p').filter((e) => e.children.length === 0 && text(e) === label)
    for (const l of labels) {
      let p = l.parentElement
      for (let i = 0; p && i < 6; i++, p = p.parentElement) if (want(p)) return p
    }
    return null
  }
  let declaration = null
  if (declKey) {
    const wanted = DECLARATIONS[declKey]
    const row = rowByLabel('自主声明', (p) => p.querySelector('[class*="selectBox"], [class*="selectText"]'))
    const box = row && (row.querySelector('[class*="selectBox"]') || row.querySelector('[class*="selectText"]'))
    if (!box) return { error: '自主声明 row not found', hint: 'The post page changed; this adapter needs updating.' }
    const current = () => text(row.querySelector('[class*="selectText"]') || box)
    if (current().indexOf(wanted) === -1) {
      if (left() < 1800) return incomplete('declaration')
      click(box)
      // Re-query every time: the dialog re-renders when an option grows sub-choices.
      const dialog = () => all('.semi-modal').find((m) => /添加声明/.test(text(m)))
      const modal = await waitFor(dialog, 1500)
      if (!modal) return { error: 'The 自主声明 dialog did not open', hint: 'Set it by hand, then re-run without --declaration.' }
      const radio = (label) => all('label', dialog() || modal).find((l) => text(l) === label)
      const r = radio(wanted)
      if (!r) return { error: 'Option not in the 自主声明 dialog: ' + wanted, hint: 'Douyin changed the options; this adapter needs updating.' }
      click(r)
      if (declKey === 'repost') {
        const outside = await waitFor(() => radio('取材站外'), 800)
        if (outside) click(outside)
      }
      const ok = await waitFor(() => all('button', dialog() || modal).find((b) => text(b) === '确定' && !b.disabled && b.getAttribute('disabled') == null), 800)
      if (!ok) return { error: 'The 自主声明 dialog would not confirm', hint: 'Finish it by hand, then re-run without --declaration.' }
      click(ok)
      await waitFor(() => !dialog(), 1000)
    }
    declaration = current() || wanted
    done.push('declaration')
  }

  // ---- 谁可以看 ---------------------------------------------------------------
  const visRow = rowByLabel('谁可以看', (p) => p.querySelectorAll('label').length >= 3)
  const visLabel = visRow && all('label', visRow).find((l) => text(l) === VISIBILITY[visKey])
  if (!visLabel) return { error: '谁可以看 options not found', hint: 'The post page changed; this adapter needs updating.' }
  if (visLabel.getAttribute('data-checked') !== 'true') {
    click(visLabel)
    await waitFor(() => visLabel.getAttribute('data-checked') === 'true', 800)
    if (visLabel.getAttribute('data-checked') !== 'true') return { error: 'Could not set 谁可以看 to ' + VISIBILITY[visKey] }
  }
  done.push('visibility')

  // ---- 发文助手 findings (reported, never blocking) ---------------------------
  const assistant = D.querySelector('[class*="postAssistant"]')
  if (assistant) {
    for (const t of all('[class*="detectItemTitle"]', assistant)) {
      const s = text(t)
      if (s && !/未见异常/.test(s)) warnings.push(s)
    }
    for (const s of all('[class*="suggest-"]', assistant)) {
      const t = text(s.querySelector('[class*="title-"]'))
      const d = text(s.querySelector('[class*="desc-"]'))
      if (t) warnings.push(d ? t + '：' + d : t)
    }
    const detecting = assistant.querySelector('[class*="detectingStatus"]')
    if (detecting && /检测中/.test(text(detecting))) warnings.push('发文助手 still checking: ' + text(detecting))
  }

  // ---- publish / save draft -------------------------------------------------
  if (captcha()) return CAPTCHA
  if (left() < 1500) return incomplete('submit')
  const label = draft ? '暂存离开' : '发布'
  const button = all('button').find((b) => text(b) === label)
  if (!button) return { error: 'No 「' + label + '」 button on the page', hint: 'The post page changed; this adapter needs updating.' }
  const toasts = () => all('.semi-toast-content-text, [class*="toast-content"]').map(text).filter(Boolean)
  const toastsBefore = toasts()
  if (!draft) markPublishClick()
  click(button)
  const base = { title, topics, skipped_topics: skipped, declaration, visibility: VISIBILITY[visKey], warnings }
  const outcome = await waitFor(() => {
    if (!/\/content\/post\/video/.test(String(W.location.pathname))) return { moved: true }
    if (captcha()) return { captcha: true }
    const fresh = toasts().filter((t) => toastsBefore.indexOf(t) === -1)
    const bad = fresh.find((t) => /请|失败|不能|错误|超过|最少|至少|上传中/.test(t))
    if (bad) return { toast: bad }
    return null
  }, Math.min(20000, Math.max(500, left() - 300)), 100)
  if (outcome && outcome.captcha) return CAPTCHA
  if (outcome && outcome.toast) {
    return Object.assign({ error: 'Douyin refused: ' + outcome.toast, hint: 'Fix it on the page (or in the arguments) and run again.' }, base)
  }
  if (outcome && outcome.moved) {
    return Object.assign({ ok: true, status: draft ? 'draft' : 'published', url: String(W.location.href) }, base, {
      note: draft
        ? 'Douyin keeps one unfinished video: the upload page now offers 继续编辑 (resume) / 放弃 (discard) for it.'
        : 'New works show 审核中 in /creator-micro/content/manage until review passes.',
    })
  }
  return Object.assign({
    ok: true,
    status: draft ? 'draft_clicked' : 'publish_clicked',
    url: String(W.location.href),
    hint: 'Clicked 「' + label + '」 but the page had not moved on within the time limit. Check ' +
      (draft ? 'the upload page (a saved draft shows 你还有上次未发布的视频 … 继续编辑 / 放弃)' : '/creator-micro/content/manage') + ' before running again: a re-run could post twice.',
  }, base)
}
