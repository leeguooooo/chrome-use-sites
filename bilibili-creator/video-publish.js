/* @meta
{
  "name": "bilibili-creator/video-publish",
  "description": "Upload a local video (--video), fill in and publish (立即投稿) or save as a draft (存草稿) in Bilibili's creator center. One command with --until-done; without --video it fills in a video already uploaded on the 投稿 page",
  "timeout": 900,
  "domain": "member.bilibili.com",
  "args": {
    "video": {"required": false, "type": "file", "input": ".bcc-upload-wrapper input[type=file]", "description": "Local video file to upload (needs chrome-use 1.5.149+). The adapter opens the 投稿 page and hands the file to it; use with --until-done so the run waits for 上传完成"},
    "title": {"required": true, "description": "标题, at most 80 characters"},
    "description": {"required": false, "description": "简介, at most 2000 characters. Newlines start new paragraphs"},
    "tags": {"required": true, "description": "Comma-separated 标签, 1 to 10, each at most 20 characters. A tag that matches one of Bilibili's 推荐标签 is clicked there; the rest are typed and entered. Tags already on the form that are not listed are removed"},
    "category": {"required": false, "description": "分区 by display name as the 分区 menu shows it (科技数码, 人工智能, 知识 …). A path such as \"科技 → 计算机技术\" is matched segment by segment against the menu. Omit to keep what Bilibili picked"},
    "type": {"required": false, "description": "self (default) = 自制: ticks 内容为自制：未经作者允许，禁止转载 | repost = 转载 (needs --source)"},
    "source": {"required": false, "description": "转载来源 (URL or name). Required with --type repost"},
    "declaration": {"required": false, "description": "创作声明: ai (含AI生成内容) | fiction (含虚构演绎内容) | promo (内容含营销信息) | opinion (个人观点，仅供参考) | none (内容无需标注). Not combinable with --type repost, which uses the same menu. Omit to keep the current one (none if empty)"},
    "visibility": {"required": false, "description": "public (default, 公开可见) | private (仅自己可见)"},
    "draft": {"required": false, "description": "true = click 存草稿 instead of 立即投稿 (default false)"},
    "submit": {"required": false, "description": "false = fill the form and stop before 立即投稿 / 存草稿, to check it first (default true)"}
  },
  "capabilities": ["dom"],
  "readOnly": false,
  "example": "chrome-use site bilibili-creator/video-publish --video ./clip.mp4 --until-done --title \"Hello\" --description @desc.txt --tags \"Claude Code,开源\" --category 科技数码 --declaration ai --draft true"
}
*/

async function(args) {
  args = args || {}
  const W = window
  const D = document
  // Every wait draws on this budget; a run that is short on time stops at a
  // safe point with status "incomplete" and the same command continues where
  // it left off. chrome-use 1.5.149+ says how long the run has
  // (args.budgetMs); older versions abandon an evaluation after ~8 s.
  const START = Date.now()
  const BUDGET_MS = args.budgetMs > 0 ? Math.max(7000, args.budgetMs - 2000) : 7000
  const left = () => BUDGET_MS - (Date.now() - START)
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const truthy = (v) => /^(1|true|yes|y|on)$/i.test(String(v == null ? '' : v).trim())
  const chars = (s) => Array.from(String(s || '')).length
  const clean = (s) => String(s == null ? '' : s).replace(/[​ ]/g, ' ').replace(/\s+/g, ' ').trim()
  const text = (el) => clean(el && el.textContent)
  const all = (sel, root) => Array.from((root || D).querySelectorAll(sel))
  const tagKey = (s) => clean(s).toLowerCase().replace(/\s+/g, '')
  // The page keeps hidden copies of some widgets (the 批量操作 dialog has its
  // own tag input, closed dialogs stay in the DOM): only the main form counts.
  const inForm = (el) => !el.closest('.bcc-dialog__wrap, #batch-fill-dialog')
  const one = (sel) => all(sel).find(inForm) || null
  const hidden = (el) => !!(el && el.closest('[style*="display: none"]'))
  const rendered = (el) => typeof el.getClientRects !== 'function' || el.getClientRects().length > 0

  const STATEMENTS = {
    none: '内容无需标注',
    ai: '含AI生成内容',
    fiction: '含虚构演绎内容',
    promo: '内容含营销信息',
    opinion: '个人观点，仅供参考',
  }
  const REPRINT = '内容为转载'
  const VISIBILITY = { public: '公开可见', private: '仅自己可见' }

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
    if (typeof el.click === 'function') el.click()
    else el.dispatchEvent(new W.MouseEvent('click', { bubbles: true, cancelable: true, view: W }))
  }
  const key = (el, name, code) => {
    for (const type of ['keydown', 'keypress', 'keyup']) {
      el.dispatchEvent(new W.KeyboardEvent(type, { key: name, code: name, keyCode: code, which: code, bubbles: true, cancelable: true }))
    }
  }
  const setInput = (input, value) => {
    input.focus()
    const setter = Object.getOwnPropertyDescriptor(W.HTMLInputElement.prototype, 'value').set
    setter.call(input, value)
    input.dispatchEvent(new W.InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }))
    input.dispatchEvent(new W.Event('change', { bubbles: true }))
  }
  // Read-only peek at the Vue 2 component the form renders from, for state the
  // DOM does not show (e.g. whether the 自制 box is ticked). Never written to.
  const vm = (el) => { for (let e = el; e; e = e.parentElement) if (e.__vue__) return e.__vue__; return null }
  const store = () => { const v = vm(one('.submit-container') || D.querySelector('#video-up-app')); return v && v.$store ? v.$store.state : null }

  const captcha = () => {
    const s = store()
    if (s && s.captcha && (s.captcha === true || s.captcha.show || s.captcha.visible)) return true
    return all('iframe').some((f) => /captcha|geetest|verify/i.test(f.getAttribute('src') || '')) ||
      // The page root carries a `risk-captcha-adapt` class all the time, so a
      // class match alone means nothing: it has to be a shown challenge.
      all('[class*="geetest"], [class*="captcha"]').some((e) => !hidden(e) && !e.querySelector('.video-title') && rendered(e) &&
        /验证|拖动|滑块|按顺序点击|请点击/.test(text(e))) ||
      all('.bcc-dialog__wrap').some((m) => !hidden(m) && /安全验证|验证码|实名认证|绑定手机|手机号验证/.test(text(m)))
  }
  const CAPTCHA = {
    error: 'Bilibili is asking for a verification (captcha / real-name / phone)',
    hint: 'Stop here and clear it by hand in the browser. Do not re-run in a loop.',
  }

  // ---- argument checks (before touching the page) ---------------------------
  const title = String(args.title == null ? '' : args.title).trim()
  if (!title) return { error: 'Missing argument: title' }
  if (chars(title) > 80) return { error: 'Title is ' + chars(title) + ' characters; Bilibili allows 80', hint: 'Shorten --title.' }
  const description = String(args.description == null ? '' : args.description).replace(/\r\n?/g, '\n').replace(/\s+$/, '')
  if (chars(description) > 2000) return { error: 'Description is ' + chars(description) + ' characters; Bilibili allows 2000' }
  const tags = []
  for (const t of String(args.tags || '').split(/[,，]/)) {
    const n = clean(t).replace(/^#+|#+$/g, '').trim()
    if (n && !tags.some((x) => tagKey(x) === tagKey(n))) tags.push(n)
  }
  if (!tags.length) return { error: 'Missing argument: tags', hint: 'Bilibili needs at least one 标签: --tags "tag1,tag2".' }
  if (tags.length > 10) return { error: tags.length + ' tags; Bilibili allows 10' }
  const long = tags.find((t) => chars(t) > 20)
  if (long) return { error: 'Tag "' + long + '" is ' + chars(long) + ' characters; Bilibili allows 20' }
  const typeKey = String(args.type == null || args.type === '' ? 'self' : args.type).trim().toLowerCase()
  if (!/^(self|repost)$/.test(typeKey)) return { error: 'Unknown type: ' + args.type, hint: 'Use self or repost.' }
  const source = String(args.source == null ? '' : args.source).trim()
  if (typeKey === 'repost' && !source) return { error: '--type repost needs --source', hint: 'Pass the original URL or author as --source.' }
  const declKey = String(args.declaration == null ? '' : args.declaration).trim().toLowerCase()
  if (declKey && !STATEMENTS[declKey]) {
    return { error: 'Unknown declaration: ' + args.declaration, hint: 'Use one of: ' + Object.keys(STATEMENTS).join(' ') }
  }
  if (typeKey === 'repost' && declKey && declKey !== 'none') {
    return { error: '--declaration ' + declKey + ' cannot be combined with --type repost', hint: 'Bilibili\'s 创作声明 menu takes one entry, and 内容为转载 is one of them.' }
  }
  const visKey = String(args.visibility == null || args.visibility === '' ? 'public' : args.visibility).trim().toLowerCase()
  if (!VISIBILITY[visKey]) return { error: 'Unknown visibility: ' + args.visibility, hint: 'Use public or private.' }
  const draft = truthy(args.draft)
  const submit = !/^(0|false|no|n|off)$/i.test(String(args.submit == null ? '' : args.submit).trim())
  const category = String(args.category == null ? '' : args.category).trim()

  // ---- where are we -----------------------------------------------------------
  const href = String(W.location.href)
  if (/passport\.bilibili\.com|\/login/.test(href)) {
    return { error: 'Not signed in to Bilibili', hint: 'Log in at https://passport.bilibili.com/login in this browser, then retry.' }
  }
  if (captcha()) return CAPTCHA

  // A finished submit replaces the form with a success screen. Report it rather
  // than looking for a form, so a re-run after a lost reply never posts twice.
  const bvidFrom = (s) => { const m = String(s || '').match(/\bBV[0-9A-Za-z]{10}\b/); return m ? m[0] : null }
  const successState = () => {
    const s = store()
    const bvid = (s && s.completeBvid) || null
    const box = all('[class*="success"], [class*="complete"]').find((e) => inForm(e) && !hidden(e) && /投稿成功|投递成功|稿件投递|提交成功/.test(text(e)) && !e.closest('.file-list, .task-list, .cover'))
    if (!bvid && !box) return null
    const links = box ? all('a', box).map((a) => a.getAttribute('href') || '') : []
    return { bvid: bvid || bvidFrom(links.join(' ')) || bvidFrom(text(box)), text: box ? text(box).slice(0, 200) : '' }
  }
  const done0 = successState()
  if (done0) {
    return {
      ok: true,
      status: 'already_submitted',
      bvid: done0.bvid,
      url: done0.bvid ? 'https://www.bilibili.com/video/' + done0.bvid : null,
      page: done0.text,
      warnings: [],
      hint: 'This tab already shows a finished submit. New videos appear under 内容管理 → 稿件管理 as 审核中 until review passes.',
    }
  }

  // --video is a local file chrome-use hands over: {path, name, size, setOn}.
  // An older chrome-use passes the path as a plain string and cannot attach it.
  const localFile = args.video && typeof args.video === 'object' && typeof args.video.setOn === 'function' ? args.video : null
  if (args.video && !localFile) {
    return {
      error: '--video needs chrome-use 1.5.149 or newer',
      hint: 'Run chrome-use upgrade. Or upload first: chrome-use upload \'.bcc-upload-wrapper input[type=file]\' ./video.mp4, then run this without --video.',
    }
  }
  const progress = (m) => { if (typeof args.progress === 'function') args.progress(m) }
  // With --until-done a run that is lost right after the final click (the page
  // navigating away) is run again, and that rerun no longer sees the form. It
  // must not upload the same file a second time and publish it twice.
  const fileStamp = localFile ? localFile.name + '|' + localFile.size : ''
  const PUB_MARK = 'cu-bilibili-published'
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

  let titleInput = one('.video-title input')
  if (!titleInput) {
    const UPLOAD_SEL = '.bcc-upload-wrapper input[type="file"]'
    const uploadBox = D.querySelector(UPLOAD_SEL)
    if (!uploadBox && /登录|扫码/.test(text(D.body).slice(0, 600))) {
      return { error: 'Not signed in to member.bilibili.com', hint: 'Log in to Bilibili in this browser, then retry.' }
    }
    if (localFile) {
      const RERUN = 'Run the same command again to continue (--until-done does it for you).'
      const clicked = publishClickedRecently()
      if (clicked) return ALREADY_CLICKED(clicked)
      const UPLOAD_PATH = '/platform/upload/video/frame'
      if (!uploadBox && W.location.pathname.indexOf(UPLOAD_PATH) !== 0) {
        progress('opening the 投稿 page')
        W.location.href = 'https://member.bilibili.com' + UPLOAD_PATH
        return { ok: true, status: 'incomplete', stopped_at: 'open-upload', done: [], warnings: [], hint: RERUN }
      }
      const box = uploadBox || await waitFor(() => D.querySelector(UPLOAD_SEL), 5000)
      if (!box) return { error: 'No video file input on the 投稿 page', hint: 'The page changed; upload with chrome-use upload instead.' }
      progress('uploading ' + localFile.name)
      try {
        await localFile.setOn(UPLOAD_SEL)
      } catch (e) {
        return { error: 'Could not attach ' + localFile.name + ': ' + ((e && e.message) || e) }
      }
      // The form replaces the drop zone in place once the file is accepted.
      titleInput = await waitFor(() => one('.video-title input'), 15000, 150)
      if (!titleInput) {
        return { ok: true, status: 'incomplete', stopped_at: 'upload', done: [], warnings: [], file: localFile.name, size: localFile.size, hint: 'The file was handed over but the form is not up yet. ' + RERUN }
      }
    }
  }
  if (!titleInput) {
    const uploadBox = D.querySelector('.bcc-upload-wrapper input[type="file"]')
    return {
      error: uploadBox ? 'No video uploaded yet' : 'Not on the 投稿 page (' + W.location.pathname + ')',
      hint: 'First: chrome-use open https://member.bilibili.com/platform/upload/video/frame && ' +
        'chrome-use upload \'.bcc-upload-wrapper input[type=file]\' ./video.mp4, then run this again. With chrome-use 1.5.149+ pass --video ./video.mp4 --until-done instead.',
    }
  }

  const done = []
  const warnings = []
  const incomplete = (step) => ({
    ok: false,
    status: 'incomplete',
    stopped_at: step,
    done,
    warnings,
    hint: 'Ran out of time inside chrome-use\'s 8 s window. Every step is idempotent: run the same command again and it continues. Nothing was submitted.',
  })

  // ---- upload state -------------------------------------------------------------
  // One row per file (分P) with a status line: 上传中 … / 上传完成 / 上传失败.
  const upload = () => {
    const rows = all('.file-list .file-item').filter(inForm)
    if (!rows.length) return { state: 'unknown', percent: null, files: 0 }
    let state = 'done'
    let percent = 100
    for (const r of rows) {
      const st = r.querySelector('.file-item-content-status')
      const t = text(st)
      const bar = r.querySelector('.file-item-content-progress-inner')
      const w = bar && /width:\s*([\d.]+)%/.exec(bar.getAttribute('style') || '')
      const m = /(\d{1,3}(?:\.\d+)?)\s*%/.exec(t)
      const p = m ? Number(m[1]) : w ? Number(w[1]) : null
      if (/失败|错误|异常/.test(t) || (bar && bar.classList.contains('error'))) return { state: 'failed', percent: p, files: rows.length, text: t }
      if (!(st && st.querySelector('.success')) && !/上传完成|已完成/.test(t)) {
        state = 'uploading'
        if (p != null) percent = Math.min(percent, p)
        else percent = null
      }
    }
    return { state, percent: state === 'done' ? 100 : percent, files: rows.length }
  }
  const up0 = upload()
  if (up0.state === 'failed') return { error: 'The video upload failed: ' + (up0.text || ''), hint: 'Use 更换视频 on the page (or upload again), then re-run.' }
  if (up0.files > 1) warnings.push(up0.files + ' files (分P) are queued in this 稿件; all of them are submitted together')

  // ---- 标题 ----------------------------------------------------------------------
  if (titleInput.value !== title) {
    setInput(titleInput, title)
    await sleep(60)
    if (titleInput.value !== title) return { error: 'The title field did not take the value', hint: 'Fill 标题 by hand and re-run.' }
  }
  done.push('title')

  // ---- 创作声明 (one menu: statements + 内容为转载) and the 自制 box --------------
  const statementBox = one('.creation-statement-container')
  if (!statementBox) return { error: '创作声明 not found', hint: 'The 投稿 page changed; this adapter needs updating.' }
  const csVm = vm(statementBox.querySelector('.statement-main') || statementBox)
  const statementInput = statementBox.querySelector('.bcc-select-input-inner')
  const currentStatement = () => clean(statementInput && statementInput.value) || text(statementBox.querySelector('.bcc-select-input-wrap'))
  const wantedStatement = typeKey === 'repost' ? REPRINT
    : declKey ? STATEMENTS[declKey]
      : currentStatement() && currentStatement() !== REPRINT ? null : STATEMENTS.none
  if (wantedStatement && currentStatement() !== wantedStatement) {
    if (left() < 1500) return incomplete('statement')
    click(statementBox.querySelector('.bcc-select-input-wrap') || statementInput)
    await sleep(120)
    const option = all('li.bcc-option', statementBox).find((li) => text(li) === wantedStatement)
    if (!option) {
      return {
        error: 'Option not in the 创作声明 menu: ' + wantedStatement,
        hint: 'Menu has: ' + all('li.bcc-option', statementBox).map(text).join(' / ') + '. Bilibili changed the options; this adapter needs updating.',
      }
    }
    if (option.classList.contains('disabled') || option.classList.contains('bcc-option-disabled')) {
      return { error: '创作声明 option is disabled: ' + wantedStatement }
    }
    click(option)
    const ok = await waitFor(() => currentStatement() === wantedStatement, 1000)
    if (!ok) return { error: 'Could not set 创作声明 to ' + wantedStatement, hint: 'Set it by hand and re-run without --declaration.' }
  }
  const statement = currentStatement()
  done.push('statement')

  const authEl = statementBox.querySelector('.auth-content')
  const authChecked = () => {
    if (csVm && typeof csVm.isAuthChecked === 'boolean') return csVm.isAuthChecked
    return !!(authEl && (/checked|active|selected/.test(authEl.className) || authEl.querySelector('[class*="checked"], [class*="tick"], [class*="icon-duihao"]')))
  }
  let selfMade = false
  if (typeKey === 'self') {
    if (!authEl) warnings.push('No 内容为自制 option on the form; 自制 was not declared')
    else {
      if (!authChecked()) {
        click(authEl)
        await waitFor(authChecked, 800)
      }
      selfMade = authChecked()
      if (!selfMade) warnings.push('Could not tick 内容为自制：未经作者允许，禁止转载')
    }
    done.push('type')
  } else {
    // 内容为转载 shows a 转载来源 field once picked.
    const srcInput = await waitFor(() => all('input', statementBox).find((i) => i !== statementInput && i.getAttribute('type') !== 'checkbox' && !hidden(i)), 1000)
    if (!srcInput) return { error: 'No 转载来源 field after choosing 内容为转载', hint: 'Fill the source by hand, then re-run.' }
    if (srcInput.value !== source) {
      setInput(srcInput, source)
      srcInput.dispatchEvent(new W.Event('blur', { bubbles: false }))
      await sleep(60)
      if (srcInput.value !== source) return { error: 'The 转载来源 field did not take the value' }
    }
    done.push('type')
  }
  // Close the menu if it is still open (a click outside).
  if (statementBox.querySelector('.bcc-select-list-wrap') && !hidden(statementBox.querySelector('.bcc-select-list-wrap'))) {
    click(one('.video-title .section-title-container') || D.body)
  }

  // ---- 分区 ------------------------------------------------------------------------
  const zoneBox = one('.video-human-type')
  if (!zoneBox) return { error: '分区 not found', hint: 'The 投稿 page changed; this adapter needs updating.' }
  const currentZone = () => text(zoneBox.querySelector('.select-item-cont'))
  let zone = currentZone()
  if (category) {
    const segs = category.split(/\s*(?:→|->|>|\/|／|·)\s*/).map(clean).filter(Boolean)
    const pick = (items) => {
      const names = items.map((it) => ({ it, name: clean(it.getAttribute('title')) || text(it.querySelector('.item-cont-main')) }))
      const full = names.find((n) => n.name === category)
      if (full) return full
      for (const s of segs.slice().reverse()) {
        const exact = names.find((n) => n.name === s)
        if (exact) return exact
      }
      for (const s of segs) {
        const loose = names.filter((n) => n.name.indexOf(s) === 0 || s.indexOf(n.name) === 0)
        if (loose.length === 1) return loose[0]
      }
      return null
    }
    // "科技 → 计算机技术" settles on 科技数码; a re-run must accept that, not reopen the menu.
    const matchesZone = (z) => !!z && (z === category || segs.some((s) => s === z || z.indexOf(s) === 0 || s.indexOf(z) === 0))
    if (!matchesZone(zone)) {
      if (left() < 1500) return incomplete('category')
      const list = () => all('.drop-list-v2-item', zoneBox)
      if (!list().length) click(zoneBox.querySelector('.select-controller'))
      const items = await waitFor(() => (list().length ? list() : null), 1200)
      if (!items) return { error: 'The 分区 menu did not open', hint: 'Pick 分区 by hand and re-run without --category.' }
      const hit = pick(items)
      if (!hit) {
        return {
          error: 'No 分区 matches "' + category + '"',
          hint: 'Current names: ' + items.map((it) => clean(it.getAttribute('title')) || text(it)).join(' / '),
        }
      }
      if (!hit.it.classList.contains('drop-list-v2-item-selected')) click(hit.it)
      else click(zoneBox.querySelector('.select-controller'))
      const ok = await waitFor(() => currentZone() === hit.name, 1000)
      if (!ok) return { error: 'Could not set 分区 to ' + hit.name }
      await sleep(150) // tag suggestions follow the 分区
    }
    zone = currentZone()
    if (zone !== category && segs.indexOf(zone) === -1) warnings.push('分区 "' + category + '" is not a current name; using ' + zone)
    done.push('category')
  }
  if (!zone) return { error: '分区 is empty', hint: 'Pass --category (e.g. 科技数码).' }

  // ---- 标签 ------------------------------------------------------------------------
  // #tag-container holds the chips and input; 推荐标签 / 参与话题 sit next to it in the same form item.
  const tagContainer = one('#tag-container') || one('.tag-container')
  const tagBox = tagContainer && (tagContainer.closest('.form-item') || tagContainer)
  const tagInput = tagContainer && all('input', tagContainer).find((i) => !hidden(i))
  if (!tagInput) return { error: '标签 input not found', hint: 'The 投稿 page changed; this adapter needs updating.' }
  const chips = () => all('.tag-pre-wrp .label-item-v2-container', tagContainer)
  const chipNames = () => chips().map((c) => text(c.querySelector('.label-item-v2-content') || c))
  const recommended = () => {
    const wrp = all('.tag-wrp', tagBox).find((w) => /推荐标签/.test(text(w.querySelector('.tag-label'))))
    return wrp ? all('.hot-tag-container', wrp).map((el) => ({ el, name: text(el) })) : []
  }
  // Errors come as a `toaster-v2-wrp error` toast, e.g. 当前tag为话题专用，不允许自定义添加.
  const toastTexts = () => all('[class*="toaster"], .bcc-message, [class*="toast"], [class*="message-content"]')
    .filter((e) => !hidden(e) && !(e.parentElement && e.parentElement.closest('[class*="toaster"], .bcc-message, [class*="toast"]')))
    .map((e) => text(e).replace(/^[^\u4e00-\u9fa5A-Za-z0-9]*[)）]\s*/, '')).filter(Boolean)
  const removed = []
  // Vue reuses the chip nodes after a removal, so look the list up afresh each time.
  const unwanted = () => chips().find((c) => !tags.some((t) => tagKey(t) === tagKey(text(c.querySelector('.label-item-v2-content') || c))))
  for (let guard = 0; guard < 12; guard++) {
    const c = unwanted()
    if (!c) break
    const name = text(c.querySelector('.label-item-v2-content') || c)
    const n0 = chips().length
    click(c)
    if (await waitFor(() => chips().length < n0, 800, 40)) removed.push(name)
    else { warnings.push('Could not remove the tag "' + name + '"'); break }
  }
  const addedTags = []
  const skippedTags = []
  for (const t of tags) {
    if (chipNames().some((n) => tagKey(n) === tagKey(t))) { addedTags.push(chipNames().find((n) => tagKey(n) === tagKey(t))); continue }
    if (left() < 1600) return incomplete('tags')
    const n0 = chips().length
    const before = toastTexts()
    const rec = recommended().find((r) => r.name === t) || recommended().find((r) => tagKey(r.name) === tagKey(t))
    if (rec) {
      click(rec.el)
    } else {
      setInput(tagInput, t)
      await sleep(30)
      key(tagInput, 'Enter', 13)
    }
    // Typed tags go through Bilibili's own check before they become a chip.
    const res = await waitFor(() => {
      if (chips().length > n0) return { ok: true }
      const fresh = toastTexts().filter((x) => before.indexOf(x) === -1)
      return fresh.length ? { toast: fresh[0] } : null
    }, 1500, 60)
    if (res && res.ok) {
      addedTags.push(chipNames().find((n) => tagKey(n) === tagKey(t)) || t)
      continue
    }
    skippedTags.push(res && res.toast ? t + ' (' + res.toast + ')' : t)
    if (tagInput.value) setInput(tagInput, '')
  }
  if (!chips().length) return { error: 'No 标签 could be added', hint: 'Bilibili refused: ' + skippedTags.join('; ') }
  done.push('tags')

  // ---- 简介 (Quill editor) ---------------------------------------------------------
  const editor = one('.desc-container .ql-editor')
  if (!editor) return { error: '简介 editor not found', hint: 'The 投稿 page changed; this adapter needs updating.' }
  const paras = () => all('p', editor).map((p) => String(p.textContent || '').replace(/ /g, ' ').replace(/\s+$/, ''))
  const editorText = () => paras().join('\n').replace(/\n+$/, '').replace(/^\n+/, '')
  const wantedDesc = description.split('\n').map((l) => l.replace(/\s+$/, '')).join('\n')
  if (editorText() !== wantedDesc) {
    if (left() < 1800) return incomplete('description')
    editor.focus()
    await sleep(40)
    if (clean(editor.textContent)) {
      D.execCommand('selectAll')
      D.execCommand('delete')
      await sleep(80)
      if (clean(editor.textContent)) return { error: 'Could not clear the existing 简介', hint: 'Clear 简介 by hand and re-run.' }
    }
    const lines = wantedDesc.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) {
        const n0 = all('p', editor).length
        key(editor, 'Enter', 13)
        await sleep(40)
        if (all('p', editor).length <= n0) D.execCommand('insertParagraph')
        await sleep(30)
      }
      if (lines[i]) { D.execCommand('insertText', false, lines[i]); await sleep(20) }
    }
    await sleep(120)
    if (editorText() !== wantedDesc) {
      return {
        error: 'The 简介 editor did not end up with the description',
        got: editorText().slice(0, 300),
        hint: 'Check 简介 on the page; re-running replaces it.',
      }
    }
  }
  done.push('description')

  // ---- 可见范围 (under 更多设置) ------------------------------------------------------
  const visOpts = all('.vu-only-self .check-radio-v2-container').filter(inForm)
  const visOpt = visOpts.find((o) => text(o.querySelector('.check-radio-v2-name')) === VISIBILITY[visKey])
  const visChecked = (o) => !!(o && o.querySelector('.check-radio-v2-box-checked'))
  if (!visOpt) {
    if (visKey !== 'public') return { error: '可见范围 option not found: ' + VISIBILITY[visKey], hint: 'The 投稿 page changed; this adapter needs updating.' }
    warnings.push('可见范围 not found on the form; left at Bilibili\'s default')
  } else if (!visChecked(visOpt)) {
    click(visOpt)
    await waitFor(() => visChecked(visOpt), 800)
    if (!visChecked(visOpt)) return { error: 'Could not set 可见范围 to ' + VISIBILITY[visKey] }
  }
  done.push('visibility')

  // ---- 封面: keep Bilibili's; if the slot is still empty take its first recommended frame
  const coverEmpty = () => !!one('.cover-main .cover-empty')
  let cover = coverEmpty() ? 'empty' : 'set'
  if (cover === 'empty') {
    const first = all('.cover-ai .img-item-cover').find(inForm)
    if (first) {
      click(first)
      if (await waitFor(() => !coverEmpty(), 1000)) cover = 'recommended_frame'
    }
    if (coverEmpty()) warnings.push('封面 is still empty; Bilibili may refuse the submit until one is chosen')
  }

  // ---- wait for the upload ----------------------------------------------------------
  let up = upload()
  if (up.state !== 'done') {
    up = (await waitFor(() => { const u = upload(); return u.state === 'done' || u.state === 'failed' ? u : null }, Math.min(1500, left() - 1500), 200)) || upload()
  }
  if (up.state === 'failed') return { error: 'The video upload failed', hint: 'Use 更换视频 on the page, then re-run.' }
  if (up.state !== 'done') {
    return {
      ok: false,
      status: 'uploading',
      upload_percent: up.percent,
      done,
      warnings,
      hint: 'The form is filled but the file is still uploading. Run the same command again in a little while; it submits once 上传完成.',
    }
  }

  // ---- submit -------------------------------------------------------------------------
  if (!submit) {
    return {
      ok: true,
      status: 'filled',
      title,
      category: zone,
      tags: chipNames(),
      removed_tags: removed,
      skipped_tags: skippedTags,
      statement,
      self_made: selfMade,
      visibility: VISIBILITY[visKey],
      cover,
      warnings,
      hint: 'Filled and uploaded; nothing was submitted. Run again without --submit false to click 「' + (draft ? '存草稿' : '立即投稿') + '」.',
    }
  }
  if (captcha()) return CAPTCHA
  if (left() < 1500) return incomplete('submit')
  const label = draft ? '存草稿' : '立即投稿'
  const button = one(draft ? '.submit-container .submit-draft' : '.submit-container .submit-add') ||
    all('.submit-container span, .submit-container button').find((b) => text(b) === label)
  if (!button) return { error: 'No 「' + label + '」 button on the page', hint: 'The 投稿 page changed; this adapter needs updating.' }
  const openDialogs = () => all('.bcc-dialog__wrap').filter((m) => !hidden(m) && !/显示通知|第一时间通知/.test(text(m))).map(text)
  const dialogsBefore = openDialogs()
  const toastsBefore = toastTexts()
  const base = {
    title,
    category: zone,
    tags: chipNames(),
    removed_tags: removed,
    skipped_tags: skippedTags,
    statement,
    self_made: selfMade,
    source: typeKey === 'repost' ? source : undefined,
    visibility: VISIBILITY[visKey],
    cover,
    warnings,
  }
  if (!draft) markPublishClick()
  click(button)
  const outcome = await waitFor(() => {
    const s = successState()
    if (s) return { success: s }
    if (captcha()) return { captcha: true }
    const fresh = toastTexts().filter((t) => toastsBefore.indexOf(t) === -1)
    const bad = fresh.find((t) => /请|失败|不能|错误|超过|至少|不可|不允许|违规|频繁|上限/.test(t))
    if (bad) return { toast: bad }
    const dlg = openDialogs().find((d) => dialogsBefore.indexOf(d) === -1)
    if (dlg) return { dialog: dlg }
    if (draft) {
      const ok = fresh.find((t) => /草稿|保存成功/.test(t))
      if (ok) return { saved: ok }
    }
    return null
  }, Math.min(20000, Math.max(500, left() - 300)), 100)
  if (outcome && outcome.captcha) return CAPTCHA
  if (outcome && outcome.toast) {
    return Object.assign({ error: 'Bilibili refused: ' + outcome.toast, hint: 'Fix it on the page (or in the arguments) and run again.' }, base)
  }
  if (outcome && outcome.dialog) {
    return Object.assign({
      ok: false,
      status: 'dialog',
      dialog: outcome.dialog.slice(0, 300),
      hint: 'Bilibili opened a dialog after 「' + label + '」 (a pre-submit check or confirmation). Read it and answer it by hand; nothing more was clicked.',
    }, base)
  }
  if (outcome && (outcome.success || outcome.saved)) {
    const bvid = outcome.success ? outcome.success.bvid : null
    return Object.assign({
      ok: true,
      status: draft ? 'draft' : 'submitted',
      bvid,
      url: bvid ? 'https://www.bilibili.com/video/' + bvid : null,
      page: outcome.success ? outcome.success.text : outcome.saved,
    }, base, {
      note: draft
        ? 'Drafts are under 内容管理 → 稿件管理 → 草稿 (member.bilibili.com/platform/upload-manager/article?group=draft).'
        : 'The video is in review (审核中) until Bilibili approves it; see 内容管理 → 稿件管理.',
    })
  }
  return Object.assign({
    ok: true,
    status: draft ? 'draft_clicked' : 'submit_clicked',
    url: href,
    hint: 'Clicked 「' + label + '」 but no success screen showed within the time limit. Check 内容管理 → 稿件管理' +
      ' before running again: a re-run could post twice.',
  }, base)
}
