/* @meta
{
  "name": "youtube-studio/video-upload",
  "description": "Fill in YouTube Studio's upload dialog (details, advanced settings, visibility) and publish, after the file was handed to the upload page",
  "domain": "studio.youtube.com",
  "args": {
    "title": {"required": false, "description": "Video title, at most 100 characters, no < or >. Omit to keep what Studio has (the file name on a fresh upload)"},
    "description": {"required": false, "description": "Description, at most 5000 characters, no < or >. Newlines are kept"},
    "visibility": {"required": false, "description": "private (default) | unlisted | public"},
    "made_for_kids": {"required": false, "description": "false (default) | true. Studio will not go on until this is answered"},
    "ai_altered": {"required": false, "description": "yes | no: the altered or synthetic content question (realistic people, events or places). Omit to leave it unanswered"},
    "category": {"required": false, "description": "Category display name as Studio shows it (e.g. 科学和技术 / Science & Technology) or its id suffix (SCIENCE, EDUCATION, ...)"},
    "tags": {"required": false, "description": "Comma-separated tags. Missing ones are added; tags already on the video are kept"},
    "playlist": {"required": false, "description": "Name of an existing playlist to add the video to"},
    "language": {"required": false, "description": "Video language: a code (zh-Hans, en, ja) or the name Studio shows (中文（简体）)"},
    "allow_embed": {"required": false, "description": "true (default) | false"},
    "wait_checks": {"required": false, "description": "true (default): do not publish until the upload, processing and copyright checks are done. false publishes as soon as the upload is complete"}
  },
  "capabilities": ["dom"],
  "readOnly": false,
  "example": "chrome-use site youtube-studio/video-upload --title \"Hello\" --description \"$(cat desc.txt)\" --visibility private --made_for_kids false --ai_altered no --category 科学和技术 --tags \"a,b\" --language zh-Hans"
}
*/

async function(args) {
  args = args || {}
  const W = window
  const D = document
  // chrome-use abandons an evaluation after ~8 s. Every wait draws on this
  // budget; the run stops at a safe point with status "incomplete" instead of
  // being cut off mid-click. Every step checks before it acts, so a re-run
  // with the same arguments picks up where the last one stopped.
  const START = Date.now()
  const BUDGET_MS = 7000
  const left = () => BUDGET_MS - (Date.now() - START)
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const clean = (s) => String(s == null ? '' : s).replace(/[​ ]/g, ' ').replace(/\s+/g, ' ').trim()
  const text = (el) => clean(el && el.textContent)
  const all = (sel, root) => Array.from((root || D).querySelectorAll(sel))
  const chars = (s) => Array.from(String(s || '')).length
  const bool = (v, dflt) => {
    if (v == null || String(v).trim() === '') return dflt
    if (/^(1|true|yes|y|on)$/i.test(String(v).trim())) return true
    if (/^(0|false|no|n|off)$/i.test(String(v).trim())) return false
    return null
  }
  const waitFor = async (fn, ms, step) => {
    const until = Date.now() + Math.max(0, Math.min(ms, left()))
    for (;;) {
      const v = fn()
      if (v) return v
      if (Date.now() >= until) return null
      await sleep(step || 80)
    }
  }
  // Studio is Polymer on shady DOM: a plain DOM click is what its tap
  // handlers take. A pointer click at the element's centre is often
  // occluded by a banner, and extra synthetic mousedown/up can toggle twice.
  const click = (el) => el.click()
  const shown = (el) => {
    for (let p = el; p && p.getAttribute; p = p.parentElement) {
      if (p.hasAttribute('hidden') || p.getAttribute('aria-hidden') === 'true') return false
      const st = p.getAttribute('style') || ''
      if (/display:\s*none/.test(st)) return false
    }
    return true
  }

  // ---- arguments --------------------------------------------------------------
  const VIS = { private: 'PRIVATE', unlisted: 'UNLISTED', public: 'PUBLIC' }
  const visKey = String(args.visibility == null || args.visibility === '' ? 'private' : args.visibility).trim().toLowerCase()
  if (!VIS[visKey]) return { error: 'Unknown visibility: ' + args.visibility, hint: 'Use private, unlisted or public.' }
  const title = args.title == null ? null : String(args.title).replace(/\s+/g, ' ').trim()
  if (title != null) {
    if (!title) return { error: '--title is empty' }
    if (chars(title) > 100) return { error: 'Title is ' + chars(title) + ' characters; YouTube allows 100', hint: 'Shorten --title.' }
    if (/[<>]/.test(title)) return { error: 'YouTube does not accept < or > in the title' }
  }
  const description = args.description == null ? null : String(args.description).replace(/\r\n?/g, '\n').replace(/\s+$/, '')
  if (description != null) {
    if (chars(description) > 5000) return { error: 'Description is ' + chars(description) + ' characters; YouTube allows 5000' }
    if (/[<>]/.test(description)) return { error: 'YouTube does not accept < or > in the description' }
  }
  const kids = bool(args.made_for_kids, false)
  if (kids === null) return { error: '--made_for_kids must be true or false' }
  let altered = null
  if (args.ai_altered != null && String(args.ai_altered).trim() !== '') {
    altered = bool(args.ai_altered, null)
    if (altered === null) return { error: '--ai_altered must be yes or no' }
  }
  const embed = bool(args.allow_embed, true)
  if (embed === null) return { error: '--allow_embed must be true or false' }
  const waitChecks = bool(args.wait_checks, true)
  if (waitChecks === null) return { error: '--wait_checks must be true or false' }
  const tags = []
  for (const t of String(args.tags || '').split(/[,，]/)) {
    const n = t.replace(/\s+/g, ' ').trim()
    if (n && !tags.some((x) => x.toLowerCase() === n.toLowerCase())) tags.push(n)
  }
  if (tags.join(',').length > 500) return { error: 'Tags add up to more than 500 characters; YouTube allows 500' }
  const category = clean(args.category)
  const language = clean(args.language)
  const playlist = clean(args.playlist)

  // ---- an already published video: its edit page -------------------------------
  // /video/<id>/edit has a visibility picker (popup with the same radios, 完成)
  // and a page-level 保存. Only --visibility is applied there.
  const editVisibility = async (id) => {
    const warnings = []
    const ignored = ['title', 'description', 'ai_altered', 'category', 'tags', 'playlist', 'language'].filter((k) => args[k] != null && String(args[k]) !== '')
    if (ignored.length) warnings.push('On the edit page only --visibility is applied; ignored: ' + ignored.join(', '))
    const url = 'https://youtu.be/' + id
    const field = D.querySelector('ytcp-video-metadata-visibility')
    if (!field) return { error: 'Visibility field not found on the edit page', hint: 'Wait for the page to load, or the page changed.' }
    const popup = () => {
      const host = D.querySelector('ytcp-video-visibility-edit-popup')
      const p = host && host.querySelector('tp-yt-paper-dialog')
      return p && shown(p) && host.querySelector('tp-yt-paper-radio-button[name="PUBLIC"]') ? host : null
    }
    const current = () => {
      const host = D.querySelector('ytcp-video-visibility-edit-popup')
      const r = host && host.querySelector('tp-yt-paper-radio-button[aria-checked="true"]')
      return r && r.getAttribute('name')
    }
    const saveBtn = () => D.querySelector('ytcp-button#save')
    const enabled = (b) => b && !b.hasAttribute('disabled') && b.getAttribute('aria-disabled') !== 'true'
    if (!popup()) {
      click(field.querySelector('#select-button') || field)
      if (!(await waitFor(popup, 2000))) return { error: 'The visibility picker did not open', url }
    }
    const host = popup()
    const was = current()
    const r = host.querySelector('tp-yt-paper-radio-button[name="' + VIS[visKey] + '"]')
    if (!r) return { error: 'Visibility option ' + VIS[visKey] + ' not found', url }
    if (r.getAttribute('aria-checked') !== 'true') {
      click(r)
      await waitFor(() => r.getAttribute('aria-checked') === 'true', 800)
    }
    if (r.getAttribute('aria-checked') !== 'true') return { error: 'Could not pick ' + visKey, url }
    const ok = host.querySelector('#save-button')
    const cancel = host.querySelector('#cancel-button')
    if (enabled(ok)) click(ok)
    else if (cancel) click(cancel) // nothing changed in the popup
    await waitFor(() => !popup(), 1500)
    if (enabled(saveBtn())) {
      if (verification()) return VERIFY
      click(saveBtn())
      const saved = await waitFor(() => !enabled(saveBtn()), Math.max(500, left() - 300), 100)
      if (!saved) return { ok: false, status: 'save_clicked', url, visibility: visKey, warnings, hint: 'Clicked 保存 but it did not settle in time; reload the edit page and check.' }
      return { ok: true, status: 'visibility_changed', from: was, url, visibility: visKey, warnings }
    }
    return { ok: true, status: was === VIS[visKey] ? 'unchanged' : 'visibility_changed', from: was, url, visibility: visKey, warnings }
  }

  // ---- where are we -------------------------------------------------------------
  const verification = () => {
    if (all('iframe').some((f) => /recaptcha|challenge/i.test(f.getAttribute('src') || '') && shown(f))) return true
    return all('tp-yt-paper-dialog, ytcp-dialog, [role="dialog"]').some((m) =>
      shown(m) && /验证你的身份|确认是你本人|人机验证|Verify it.?s you|verify your identity|confirm it.?s you/i.test(text(m)))
  }
  const VERIFY = {
    error: 'YouTube is asking for a verification (captcha / identity check)',
    hint: 'Stop here and clear it by hand in the browser. Do not re-run in a loop.',
  }
  if (verification()) return VERIFY

  const channel = (String(W.location.pathname || '').match(/\/channel\/(UC[\w-]+)/) || [])[1]
  const uploadUrl = 'https://studio.youtube.com/channel/' + (channel || '<channel id>') + '/videos/upload?d=ud'
  const dialog = D.querySelector('ytcp-uploads-dialog')
  const paper = dialog && dialog.querySelector('tp-yt-paper-dialog')
  const isOpen = () => !!(paper && shown(paper) && dialog.getAttribute('workflow-step'))
  // Right after `chrome-use upload` the dialog still says SELECT_FILES and
  // has no video-id for a moment (seen live); give it a couple of seconds.
  if (isOpen() && (dialog.getAttribute('workflow-step') === 'SELECT_FILES' || !dialog.getAttribute('video-id'))) {
    await waitFor(() => dialog.getAttribute('workflow-step') !== 'SELECT_FILES' && dialog.getAttribute('video-id'), 3000, 150)
  }
  const step = dialog && dialog.getAttribute('workflow-step')
  const videoId = dialog && dialog.getAttribute('video-id')
  const editId = (String(W.location.pathname || '').match(/^\/video\/([\w-]{11})\/edit/) || [])[1]
  if (editId && !isOpen()) return editVisibility(editId)
  if (!isOpen() || step === 'SELECT_FILES' || !videoId) {
    if (/accounts\.google\.com|ServiceLogin/.test(String(W.location.href))) {
      return { error: 'Not signed in to YouTube Studio', hint: 'Sign in at https://studio.youtube.com in this browser, then retry.' }
    }
    return {
      error: step === 'SELECT_FILES' ? 'No video uploaded yet' : 'No open upload dialog on this page',
      hint: 'First: chrome-use open \'' + uploadUrl + '\' && chrome-use upload \'input[type=file]\' ./video.mp4, then run this again. ' +
        'If a run already clicked publish, the dialog is gone: check the Content page instead of re-running.',
    }
  }
  const url = 'https://youtu.be/' + videoId

  // ---- upload / processing / checks -------------------------------------------
  const errorSection = dialog.querySelector('ytcp-error-section')
  if (errorSection && shown(errorSection)) {
    return { error: 'Studio shows an error in the upload dialog: ' + text(errorSection.querySelector('#error-message') || errorSection), url }
  }
  const progress = () => {
    const p = dialog.querySelector('ytcp-video-upload-progress')
    const label = text(p && p.querySelector('.progress-label'))
    const checks = (p && p.getAttribute('checks-summary-status-v2')) || ''
    const m = label.match(/(\d{1,3})\s*%/)
    let state = 'unknown'
    if (/失败|已拒绝|上限|failed|rejected|limit reached/i.test(label)) state = 'failed'
    else if (p && p.hasAttribute('uploading')) state = 'uploading'
    else if (/COMPLETED/.test(checks) || /检查完毕|Checks complete/i.test(label)) state = 'checked'
    else if (/正在检查|检查中|Checking|still checking/i.test(label)) state = 'checking'
    else if (/上传完毕|处理|Upload complete|Processing/i.test(label) || /IN_PROGRESS|STARTED/.test(checks)) state = 'processing'
    return { state, label, checks, percent: m ? Number(m[1]) : null }
  }
  const prog = progress()
  if (prog.state === 'failed') return { error: 'YouTube reports: ' + prog.label, url }

  const warnings = []
  const done = []
  const incomplete = (at) => ({
    ok: false,
    status: 'incomplete',
    stopped_at: at,
    done,
    url,
    warnings,
    hint: 'Ran out of time inside chrome-use\'s 8 s window. Every step is idempotent: run the same command again and it continues. Nothing was published.',
  })

  // ---- details (restamped on every visit, so values are re-checked) ------------
  // Studio keeps the values when you move between steps, so a run that already
  // filled and verified the details for these arguments leaves a mark on the
  // dialog and later runs go straight on instead of stepping back.
  const key = JSON.stringify([videoId, title, description, kids, altered, embed, category, language, playlist, tags])
  if (dialog.__cuDetails !== key) {
    if (step !== 'DETAILS') {
      const badge = dialog.querySelector('#step-badge-0')
      if (!badge) return { error: 'Cannot get back to the 详细信息 step', hint: 'The dialog changed; this adapter needs updating.' }
      click(badge)
      if (!(await waitFor(() => dialog.getAttribute('workflow-step') === 'DETAILS' && dialog.querySelector('#title-textarea #textbox'), 2000))) {
        return incomplete('details')
      }
    }

    const boxText = (box) => String(box.innerText != null ? box.innerText : box.textContent).replace(/[​]/g, '').replace(/ /g, ' ')
    const same = (a, b) => a.replace(/\s+/g, '') === b.replace(/\s+/g, '')
    const setBox = async (sel, value, name) => {
      const box = dialog.querySelector(sel)
      if (!box) return { error: name + ' box not found', hint: 'The dialog changed; this adapter needs updating.' }
      if (same(boxText(box), value)) return null
      // Typing keys into this box dropped part of a long multi-line text;
      // one insertText over a full selection goes in whole.
      box.focus()
      D.execCommand('selectAll', false, null)
      D.execCommand('insertText', false, value)
      await waitFor(() => same(boxText(box), value), 800)
      if (!same(boxText(box), value)) return { error: 'The ' + name + ' did not take the text', hint: 'Fill it by hand, then re-run without --' + name + '.' }
      return null
    }
    if (title != null) {
      const e = await setBox('#title-textarea #textbox', title, 'title')
      if (e) return e
      done.push('title')
    }
    if (description != null) {
      const e = await setBox('#description-textarea #textbox', description, 'description')
      if (e) return e
      done.push('description')
    }

    const radio = async (name) => {
      const r = dialog.querySelector('tp-yt-paper-radio-button[name="' + name + '"]')
      if (!r) return false
      if (r.getAttribute('aria-checked') !== 'true') {
        click(r)
        await waitFor(() => r.getAttribute('aria-checked') === 'true', 800)
      }
      return r.getAttribute('aria-checked') === 'true'
    }
    if (!(await radio(kids ? 'VIDEO_MADE_FOR_KIDS_MFK' : 'VIDEO_MADE_FOR_KIDS_NOT_MFK'))) {
      return { error: 'Could not answer the made-for-kids question', hint: 'The dialog changed; this adapter needs updating.' }
    }
    done.push('made_for_kids')

    // Playlist sits in the basic section.
    if (playlist) {
      const trigger = dialog.querySelector('ytcp-video-metadata-playlists ytcp-text-dropdown-trigger')
      if (!trigger) return { error: 'Playlist selector not found', hint: 'The dialog changed; this adapter needs updating.' }
      if (text(trigger).split(/\s*[,，]\s*/).indexOf(playlist) === -1 && text(trigger).indexOf(playlist) === -1) {
        if (left() < 2500) return incomplete('playlist')
        click(trigger)
        const pd = () => {
          const host = D.querySelector('ytcp-playlist-dialog')
          const p = host && host.querySelector('tp-yt-paper-dialog')
          return p && shown(p) ? host : null
        }
        const host = await waitFor(() => pd() && all('ytcp-checkbox-lit', pd()).length && pd(), 2000)
        if (!host) return { error: 'The playlist picker did not open', url }
        const boxes = all('ytcp-checkbox-lit', host)
        const labelOf = (cb) => {
          const id = cb.getAttribute('aria-labelledby')
          const l = id && host.querySelector('#' + id)
          return text(l || cb)
        }
        const cb = boxes.find((b) => labelOf(b) === playlist) || boxes.find((b) => labelOf(b).toLowerCase() === playlist.toLowerCase())
        if (cb && !cb.hasAttribute('checked')) {
          click(cb.querySelector('#checkbox') || cb)
          await waitFor(() => cb.hasAttribute('checked'), 800)
        }
        if (!cb) warnings.push('No playlist named "' + playlist + '"; the video was not added to one')
        const isDone = (b) => /^(完成|Done)$/.test(b.getAttribute('aria-label') || text(b))
        const closeBtn = all('button', host).find(isDone) || all('ytcp-button', host).find(isDone)
        if (closeBtn) click(closeBtn)
        await waitFor(() => !pd(), 1000)
        if (cb && !cb.hasAttribute('checked')) return { error: 'Could not tick playlist "' + playlist + '"', url }
      }
      done.push('playlist')
    }

    // ---- advanced settings ------------------------------------------------------
    const needAdvanced = altered != null || tags.length || category || language || embed !== null
    if (needAdvanced) {
      const expanded = () => dialog.querySelector('tp-yt-paper-radio-button[name^="VIDEO_HAS_ALTERED_CONTENT"]') || dialog.querySelector('#tags-container')
      if (!expanded()) {
        const toggle = dialog.querySelector('#toggle-button')
        if (!toggle) return { error: '显示高级设置 toggle not found', hint: 'The dialog changed; this adapter needs updating.' }
        click(toggle)
        if (!(await waitFor(expanded, 2000))) return incomplete('advanced')
      }

      if (altered != null) {
        if (!(await radio(altered ? 'VIDEO_HAS_ALTERED_CONTENT_YES' : 'VIDEO_HAS_ALTERED_CONTENT_NO'))) {
          return { error: 'Could not answer the altered content question', hint: 'The dialog changed; this adapter needs updating.' }
        }
        done.push('ai_altered')
      }

      if (tags.length) {
        const input = dialog.querySelector('#tags-container input#text-input') || dialog.querySelector('#tags-container input')
        if (!input) return { error: 'Tags input not found', hint: 'The dialog changed; this adapter needs updating.' }
        const chips = () => all('#tags-container ytcp-chip', dialog).map((c) => text(c.querySelector('#chip-text') || c))
        for (const t of tags) {
          if (chips().some((c) => c.toLowerCase() === t.toLowerCase())) continue
          if (left() < 1200) return incomplete('tags')
          const n0 = chips().length
          input.focus()
          input.value = t
          input.dispatchEvent(new W.InputEvent('input', { bubbles: true, inputType: 'insertText', data: t }))
          input.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }))
          if (!(await waitFor(() => chips().length > n0, 800))) {
            return { error: 'Tag "' + t + '" was not added', hint: 'Add it by hand, then re-run without it.' }
          }
        }
        done.push('tags')
      }

      // Dropdown menus render outside the dialog, in <ytcp-text-menu> at the
      // end of <body>; the open one is the one whose paper-dialog is shown.
      const openMenuItems = () => {
        for (const m of all('ytcp-text-menu')) {
          const p = m.querySelector('tp-yt-paper-dialog')
          if (p && shown(p)) {
            const items = all('tp-yt-paper-item', m)
            if (items.length) return items
          }
        }
        return null
      }
      const pick = async (hostSel, name, match, label) => {
        const host = dialog.querySelector(hostSel)
        const trigger = host && host.querySelector('#trigger')
        if (!trigger) return { error: label + ' selector not found', hint: 'The dialog changed; this adapter needs updating.' }
        const current = () => text(trigger.querySelector('.dropdown-trigger-text') || trigger)
        if (match({ text: current(), id: null })) return null
        if (left() < 2000) return incomplete(label)
        click(trigger)
        const items = await waitFor(openMenuItems, 1500)
        if (!items) return { error: 'The ' + label + ' menu did not open', url }
        const item = items.find((it) => match({ text: text(it), id: it.getAttribute('test-id') }))
        if (!item) {
          D.body.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
          const some = items.slice(0, 20).map((it) => text(it)).join(' / ')
          return { error: 'No ' + label + ' named "' + name + '"', hint: 'Studio offers: ' + some + (items.length > 20 ? ' / …' : '') }
        }
        const want = text(item)
        if (want === current()) {
          // Already set; the argument just named it differently (a code).
          D.body.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
          await waitFor(() => !openMenuItems(), 800)
          return null
        }
        click(item)
        await waitFor(() => current() === want, 1000)
        if (current() !== want) return { error: 'Could not set ' + label + ' to ' + want, url }
        return null
      }

      if (category) {
        const c = category.toLowerCase()
        const e = await pick('#category', category, (o) =>
          o.text.toLowerCase() === c || (o.id && o.id.toLowerCase() === 'creator_video_category_' + c), 'category')
        if (e) return e
        done.push('category')
      }
      if (language) {
        const l = language.toLowerCase()
        const e = await pick('#language-input', language, (o) =>
          o.text.toLowerCase() === l || (o.id && o.id.toLowerCase() === l), 'language')
        if (e) return e
        done.push('language')
      }

      const embedBox = dialog.querySelector('#allow-embed ytcp-checkbox-lit')
      if (embedBox) {
        if (embedBox.hasAttribute('checked') !== embed) {
          click(embedBox.querySelector('#checkbox') || embedBox)
          await waitFor(() => embedBox.hasAttribute('checked') === embed, 800)
          if (embedBox.hasAttribute('checked') !== embed) return { error: 'Could not ' + (embed ? 'allow' : 'disallow') + ' embedding', url }
        }
        done.push('allow_embed')
      } else {
        warnings.push('允许嵌入 checkbox not found; embedding left as Studio has it')
      }
    }

    // Reported, never acted on: Studio wants a one-time phone verification
    // before links in the description are clickable.
    const notice = all('div, span, p, yt-formatted-string', dialog).filter((e) =>
      /一次性验证|one-time verification/i.test(e.textContent || '') && !/一次性验证|one-time verification/i.test(
        Array.from(e.children).map((c) => c.textContent).join('')) && shown(e))[0]
    if (notice) warnings.push(text(notice))
    dialog.__cuWarnings = warnings.slice()
    const err = all('ytcp-form-error-tip', dialog).map(text).filter(Boolean)
    if (err.length) return { error: 'Studio flags the details: ' + err.join('; '), url, done }
    dialog.__cuDetails = key
  } else {
    done.push('details (verified earlier)')
    for (const w of dialog.__cuWarnings || []) warnings.push(w)
  }

  // ---- wait for the upload / checks --------------------------------------------
  const p2 = progress()
  const ready = p2.state === 'checked' || (!waitChecks && p2.state !== 'uploading' && p2.state !== 'unknown')
  if (!ready) {
    return {
      ok: false,
      status: p2.state === 'uploading' || p2.state === 'checking' ? p2.state : 'processing',
      percent: p2.percent,
      progress: p2.label,
      checks: p2.checks.replace(/^UPLOAD_CHECKS_DATA_SUMMARY_STATUS_/, '') || null,
      url,
      done,
      warnings,
      hint: 'Details are filled in. Nothing is published until ' + (waitChecks ? 'the upload and checks finish' : 'the upload finishes') +
        ': run the same command again in a little while.' +
        (/OVERDUE/.test(p2.checks) ? ' Studio says the checks are overdue (seen live for 10+ minutes on a 37 s Short); --wait_checks false saves now and the checks go on afterwards (use --visibility private for that).' : ''),
    }
  }
  if (!/未发现任何问题|No issues found/i.test(p2.label)) warnings.push('Checks: ' + p2.label)

  // ---- steps up to 公开范围 ------------------------------------------------------
  for (let i = 0; i < 4 && dialog.getAttribute('workflow-step') !== 'REVIEW'; i++) {
    if (left() < 1500) return incomplete('steps')
    const s0 = dialog.getAttribute('workflow-step')
    const next = dialog.querySelector('#next-button')
    if (!next || next.hasAttribute('disabled') || next.getAttribute('aria-disabled') === 'true') {
      const err = all('ytcp-form-error-tip', dialog).map(text).filter(Boolean)
      return { error: 'Studio will not go on from ' + s0 + (err.length ? ': ' + err.join('; ') : ''), url, done }
    }
    if (s0 === 'CHECKS' && p2.state === 'checked') {
      const ct = text(dialog.querySelector('ytcp-uploads-checks') || null)
      if (ct && !/未发现任何问题|No issues found/i.test(ct)) warnings.push('Checks step: ' + ct.slice(0, 300))
    }
    click(next)
    if (!(await waitFor(() => dialog.getAttribute('workflow-step') !== s0, 2000))) return incomplete('steps')
  }
  if (dialog.getAttribute('workflow-step') !== 'REVIEW') return incomplete('steps')

  const visRadio = await waitFor(() => dialog.querySelector('tp-yt-paper-radio-button[name="' + VIS[visKey] + '"]'), 1000)
  if (!visRadio) return { error: 'Visibility options not found', hint: 'The dialog changed; this adapter needs updating.' }
  if (visRadio.getAttribute('aria-checked') !== 'true') {
    click(visRadio)
    await waitFor(() => visRadio.getAttribute('aria-checked') === 'true', 800)
    if (visRadio.getAttribute('aria-checked') !== 'true') return { error: 'Could not set visibility to ' + visKey, url }
  }
  done.push('visibility')

  // ---- publish ----------------------------------------------------------------
  if (verification()) return VERIFY
  if (left() < 1500) return incomplete('publish')
  const doneBtn = dialog.querySelector('#done-button')
  if (!doneBtn || doneBtn.hasAttribute('disabled') || doneBtn.getAttribute('aria-disabled') === 'true') {
    return { error: 'The publish button is disabled', url, done, warnings }
  }
  const base = { url, visibility: visKey, title: title, warnings }
  click(doneBtn)
  const outcome = await waitFor(() => {
    if (verification()) return { verify: true }
    const pNow = dialog.querySelector('tp-yt-paper-dialog')
    if (!D.body.contains(dialog) || !pNow || !shown(pNow)) return { closed: true }
    const confirm = all('tp-yt-paper-dialog, ytcp-dialog').find((m) => shown(m) && !dialog.contains(m) &&
      /仍在检查|仍在处理|still (checking|processing)/i.test(text(m)))
    if (confirm) return { confirm: text(confirm).slice(0, 200) }
    return null
  }, Math.max(500, left() - 300), 100)
  if (outcome && outcome.verify) return VERIFY
  if (outcome && outcome.confirm) {
    return Object.assign({ ok: false, status: 'confirm_needed', done, hint: 'Studio asks: ' + outcome.confirm + ' Answer it by hand.' }, base)
  }
  if (outcome && outcome.closed) return Object.assign({ ok: true, status: visKey === 'private' ? 'saved' : 'published', done }, base)
  return Object.assign({
    ok: true,
    status: 'publish_clicked',
    done,
    hint: 'Clicked publish but the dialog had not closed within the time limit. Check ' + url + ' / the Content page before running again.',
  }, base)
}
