import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { createPage } from '../douyin-creator/fakedom.mjs'

// youtube-studio/video-upload drives a real channel, so it is exercised here
// against Studio's upload dialog as captured in fixtures/ (every step, the
// category / language menus, the playlist picker and the edit page's
// visibility popup; account names and ids scrubbed). The harness below keeps
// the dialog element and restamps its content on each step, as Studio does,
// and holds the form values in a model the way Studio's Polymer state does.

const fixture = (name) => fs.readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8')
const SRC = fs.readFileSync(new URL('./video-upload.js', import.meta.url), 'utf8')
const UPLOAD_URL = 'https://studio.youtube.com/channel/UC0000000000000000000000/videos/upload?d=ud'
const EDIT_URL = 'https://studio.youtube.com/video/AAAAAAAAAAA/edit'

function load(env) {
  const fetch = async () => { throw new Error('the adapter must not fetch') }
  return new Function('window', 'document', 'fetch', `return (${SRC})`)(env.window, env.document, fetch)
}

const STEP_FIXTURE = {
  VIDEO_ELEMENTS: 'step-elements.html',
  CHECKS: 'step-checks.html',
  REVIEW: 'step-review.html',
}
const ORDER = ['DETAILS', 'VIDEO_ELEMENTS', 'CHECKS', 'REVIEW']
const PROGRESS = {
  uploading: { uploading: true, checks: 'UPLOAD_CHECKS_DATA_SUMMARY_STATUS_NOT_STARTED', label: '正在上传，已完成 27% ... ' },
  processing: { uploading: false, checks: 'UPLOAD_CHECKS_DATA_SUMMARY_STATUS_NOT_STARTED', label: '上传完毕 ... 即将开始处理' },
  checking: { uploading: false, checks: 'UPLOAD_CHECKS_DATA_SUMMARY_STATUS_NOT_STARTED', label: '正在检查：24% ... 还剩 8 分钟' },
  slow: { uploading: false, checks: 'UPLOAD_CHECKS_DATA_SUMMARY_STATUS_OVERDUE', label: '检查时间比平时长，但仍在检查中。' },
  checked: { uploading: false, checks: 'UPLOAD_CHECKS_DATA_SUMMARY_STATUS_COMPLETED', label: '检查完毕。未发现任何问题。' },
  copyright: { uploading: false, checks: 'UPLOAD_CHECKS_DATA_SUMMARY_STATUS_COMPLETED', label: '检查完毕。发现了受版权保护的内容。' },
}

/**
 * The upload dialog with its moving parts wired up. `st` is Studio's model;
 * `log` records what the adapter did.
 */
function studio({ step = 'DETAILS', progress = 'checked', st: preset = {}, stuckNext = false, notice = false, captcha = false } = {}) {
  const page = createPage({ html: fixture('upload-page.html'), url: UPLOAD_URL })
  const { window, document, body } = page
  const dialog = body.querySelector('ytcp-uploads-dialog')
  const st = Object.assign({
    step, expanded: false, progress: PROGRESS[progress],
    title: 'clip one', description: '', kids: null, altered: null, embed: true,
    category: '科学和技术', language: '选择', tags: [], playlists: [], visibility: null, closed: false,
  }, preset)
  const log = { inserts: 0, clicks: [], published: false }

  const setText = (el, t) => { el.innerHTML = t.replace(/&/g, '&amp;').replace(/</g, '&lt;') }
  const radio = (name) => dialog.querySelector('tp-yt-paper-radio-button[name="' + name + '"]')
  const setRadio = (name, on) => { const r = radio(name); if (r) r.setAttribute('aria-checked', on ? 'true' : 'false') }

  function stamp() {
    const file = st.step === 'DETAILS'
      ? (st.expanded ? 'details-advanced.html' : 'details-uploading.html')
      : STEP_FIXTURE[st.step]
    const fresh = document.parse(fixture(file)).find((n) => n.tagName === 'YTCP-UPLOADS-DIALOG')
    // Studio keeps the dialog and its paper-dialog; only the content restamps.
    const paper = dialog.querySelector('tp-yt-paper-dialog')
    const freshPaper = fresh.querySelector('tp-yt-paper-dialog')
    paper.innerHTML = ''
    for (const c of [...freshPaper.childNodes]) paper.appendChild(c)
    dialog.setAttribute('workflow-step', st.step)
    dialog.setAttribute('video-id', 'AAAAAAAAAAA')
    apply()
  }
  function apply() {
    const p = dialog.querySelector('ytcp-video-upload-progress')
    if (st.progress.uploading) p.setAttribute('uploading', '')
    else p.removeAttribute('uploading')
    p.setAttribute('checks-summary-status-v2', st.progress.checks)
    setText(p.querySelector('.progress-label'), st.progress.label)
    const next = dialog.querySelector('#next-button')
    if (st.kids == null) { next.setAttribute('disabled', ''); next.setAttribute('aria-disabled', 'true') }
    else { next.removeAttribute('disabled'); next.setAttribute('aria-disabled', 'false') }
    if (st.step === 'DETAILS') {
      setText(dialog.querySelector('#title-textarea #textbox'), st.title)
      setText(dialog.querySelector('#description-textarea #textbox'), st.description)
      setRadio('VIDEO_MADE_FOR_KIDS_MFK', st.kids === true)
      setRadio('VIDEO_MADE_FOR_KIDS_NOT_MFK', st.kids === false)
      if (notice) {
        const tip = dialog.querySelector('#description-textarea')
        tip.appendChild(document.parse('<div class="notice">如需提供可点击的外部链接，请先完成一次性验证。</div>')[0])
      }
      const pl = dialog.querySelector('ytcp-video-metadata-playlists .dropdown-trigger-text')
      if (pl) setText(pl, st.playlists.join(', ') || '选择')
      if (st.expanded) {
        setRadio('VIDEO_HAS_ALTERED_CONTENT_YES', st.altered === true)
        setRadio('VIDEO_HAS_ALTERED_CONTENT_NO', st.altered === false)
        const cb = dialog.querySelector('#allow-embed ytcp-checkbox-lit')
        if (st.embed) cb.setAttribute('checked', '')
        else cb.removeAttribute('checked')
        setText(dialog.querySelector('#category .dropdown-trigger-text'), st.category)
        setText(dialog.querySelector('#language-input .dropdown-trigger-text'), st.language)
        const bar = dialog.querySelector('#tags-container ytcp-chip-bar')
        for (const c of dialog.querySelectorAll('#tags-container ytcp-chip')) c.remove()
        for (const t of st.tags) bar.appendChild(document.parse('<ytcp-chip class="chip"><div id="chip-text">' + t + '</div></ytcp-chip>')[0])
      }
    }
    if (st.step === 'REVIEW') for (const v of ['PRIVATE', 'UNLISTED', 'PUBLIC']) setRadio(v, st.visibility === v)
    const paper = dialog.querySelector('tp-yt-paper-dialog')
    if (st.closed) paper.setAttribute('style', 'display: none;')
  }
  stamp()
  if (captcha) body.appendChild(document.parse('<iframe src="https://www.google.com/recaptcha/api2/anchor?k=x"></iframe>')[0])

  // ---- text boxes -------------------------------------------------------------
  let selected = null
  document.execCommand = (cmd, _ui, value) => {
    const box = document.activeElement
    if (!box || box.id !== 'textbox') return false
    if (cmd === 'selectAll') { selected = box; return true }
    if (cmd === 'insertText') {
      log.inserts++
      const field = box.closest('#title-textarea') ? 'title' : 'description'
      st[field] = selected === box ? value : st[field] + value
      selected = null
      setText(box, st[field])
      return true
    }
    return false
  }

  // ---- menus rendered at the end of <body> ------------------------------------
  let menu = null
  const openMenu = (file, field) => {
    menu = document.parse(fixture(file)).find((n) => n.tagName === 'YTCP-TEXT-MENU')
    menu.field = field
    body.appendChild(menu)
  }
  const closeMenu = () => { if (menu) { menu.querySelector('tp-yt-paper-dialog').setAttribute('aria-hidden', 'true'); menu = null } }
  let playlistHost = null

  body.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu()
    if (e.key === 'Enter' && e.target.id === 'text-input' && e.target.value) {
      st.tags.push(e.target.value)
      e.target.value = ''
      apply()
    }
  })
  body.addEventListener('click', (e) => {
    const t = e.target
    const r = t.closest('tp-yt-paper-radio-button')
    if (r && dialog.contains(r)) {
      const name = r.getAttribute('name')
      log.clicks.push(name)
      if (name.startsWith('VIDEO_MADE_FOR_KIDS')) st.kids = name === 'VIDEO_MADE_FOR_KIDS_MFK'
      else if (name.startsWith('VIDEO_HAS_ALTERED')) st.altered = name.endsWith('_YES')
      else st.visibility = name
      apply()
      return
    }
    const item = t.closest('tp-yt-paper-item')
    if (item && menu) {
      st[menu.field] = item.textContent.trim()
      log.clicks.push(menu.field + ':' + st[menu.field])
      closeMenu()
      apply()
      return
    }
    if (t.closest('#toggle-button')) { st.expanded = true; stamp(); return }
    if (t.closest('#category #trigger')) { openMenu('category-menu.html', 'category'); return }
    if (t.closest('#language-input #trigger')) { openMenu('language-menu.html', 'language'); return }
    if (t.closest('#allow-embed')) { st.embed = !st.embed; apply(); return }
    if (t.closest('ytcp-video-metadata-playlists')) {
      playlistHost = document.parse('<ytcp-playlist-dialog>' + fixture('playlist-dialog.html') + '</ytcp-playlist-dialog>')[0]
      body.appendChild(playlistHost)
      return
    }
    const cb = t.closest('ytcp-checkbox-lit')
    if (cb && playlistHost && playlistHost.contains(cb)) { cb.setAttribute('checked', ''); return }
    const btn = t.closest('button')
    if (btn && playlistHost && playlistHost.contains(btn) && btn.getAttribute('aria-label') === '完成') {
      for (const c of playlistHost.querySelectorAll('ytcp-checkbox-lit[checked]')) {
        st.playlists.push(playlistHost.querySelector('#' + c.getAttribute('aria-labelledby')).textContent.trim())
      }
      playlistHost.querySelector('tp-yt-paper-dialog').setAttribute('aria-hidden', 'true')
      playlistHost = null
      apply()
      return
    }
    if (t.closest('#step-badge-0')) { log.clicks.push('back'); st.step = 'DETAILS'; st.expanded = false; stamp(); return }
    const next = t.closest('#next-button')
    if (next) {
      log.clicks.push('next')
      if (stuckNext || next.hasAttribute('disabled')) return
      st.step = ORDER[ORDER.indexOf(st.step) + 1]
      st.expanded = false
      stamp()
      return
    }
    if (t.closest('#done-button')) {
      log.clicks.push('done')
      log.published = true
      st.closed = true
      apply()
    }
  })
  const setProgress = (p) => { st.progress = PROGRESS[p]; apply() }
  return { window, document, body, dialog, st, log, setProgress }
}

const run = (env, args) => load(env)(Object.defineProperties({ 'cover-mode': 'keep' }, Object.getOwnPropertyDescriptors(args)))
const FULL = {
  title: 'ocs：让 Claude Code 和 Codex 互相叫醒',
  description: '第一行\n\nGitHub: https://github.com/example/repo\n#ClaudeCode #Codex',
  visibility: 'private',
  made_for_kids: 'false',
  ai_altered: 'no',
  category: '科学和技术',
  tags: 'Claude Code, Codex，AI编程',
  language: 'zh-Hans',
}

// ---- argument checks -----------------------------------------------------------

test('rejects bad arguments before touching the page', async () => {
  const env = studio()
  assert.match((await run(env, { visibility: 'friends' })).error, /Unknown visibility/)
  assert.match((await run(env, { title: 'x'.repeat(101) })).error, /100/)
  assert.match((await run(env, { description: 'a <b> c' })).error, /< or >/)
  assert.match((await run(env, { made_for_kids: 'maybe' })).error, /made_for_kids/)
  assert.match((await run(env, { ai_altered: 'sort of' })).error, /ai_altered/)
  assert.equal(env.log.clicks.length, 0)
  assert.equal(env.log.inserts, 0)
})

test('says to upload first when the dialog is still on file selection', async () => {
  const page = createPage({ html: fixture('upload-page.html'), url: UPLOAD_URL })
  const r = await run(page, FULL)
  assert.equal(r.error, 'No video uploaded yet')
  assert.match(r.hint, /chrome-use upload 'input\[type=file\]'/)
  assert.match(r.hint, /UC0000000000000000000000\/videos\/upload\?d=ud/)
})

// ---- --video (a local file handed over by chrome-use 1.5.149+) ---------------

// What chrome-use puts in args for a "type": "file" arg.
const localVideo = (env, calls, onAttach) => ({
  path: '/abs/clip.mp4',
  name: 'clip.mp4',
  size: 14000000,
  setOn: async (selector) => {
    calls.push(selector)
    const input = env.body.querySelector(selector)
    assert.ok(input, 'setOn must name an element that exists: ' + selector)
    input.files = [{ name: 'clip.mp4' }]
    if (onAttach) onAttach()
    return { attached: 1 }
  },
})

test('--video on a channel page without the dialog: opens the upload dialog URL', async () => {
  const page = createPage({ html: '<div>内容</div>', url: 'https://studio.youtube.com/channel/UC0000000000000000000000/videos' })
  const calls = []
  const r = await run(page, { ...FULL, video: localVideo(page, calls) })
  assert.equal(r.status, 'incomplete')
  assert.equal(r.stopped_at, 'open-upload')
  assert.equal(page.window.location.href, UPLOAD_URL)
  assert.deepEqual(calls, [])
})

test('--video on a page that names no channel is an error, and never an edit', async () => {
  const env = editPage('PRIVATE')
  const calls = []
  const r = await run(env, { visibility: 'public', video: localVideo(env, calls) })
  assert.match(r.error, /which channel/)
  assert.match(r.hint, /studio\.youtube\.com/)
  assert.deepEqual(calls, [])
})

test('--video on file selection: hands the file to the dialog input', async () => {
  const page = createPage({ html: fixture('upload-page.html'), url: UPLOAD_URL })
  const calls = []
  const notes = []
  const r = await run(page, { ...FULL, video: localVideo(page, calls), progress: (m) => notes.push(m) })
  assert.deepEqual(calls, ['ytcp-uploads-dialog input[type="file"]'])
  assert.equal(page.body.querySelector('input[type="file"]').files.length, 1)
  assert.deepEqual(notes, ['uploading clip.mp4'])
  // The stub never assigns a video id, so the run stops there and can be rerun.
  assert.equal(r.status, 'incomplete')
  assert.equal(r.stopped_at, 'upload')
})

test('--video with an upload already in the dialog: nothing is uploaded again', async () => {
  const env = studio({ progress: 'uploading' })
  const calls = []
  const r = await run(env, { ...FULL, video: localVideo(env, calls) })
  assert.deepEqual(calls, [])
  assert.equal(r.status, 'uploading')
  assert.equal(env.st.title, FULL.title)
})

const tabStorage = () => {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }
}

test('--video: a rerun while Studio is still taking the file in does not attach it twice', async () => {
  const page = createPage({ html: fixture('upload-page.html'), url: UPLOAD_URL })
  const calls = []
  const args = { ...FULL, video: localVideo(page, calls) }
  assert.equal((await run(page, args)).stopped_at, 'upload')
  const again = await run(page, args)
  assert.equal(again.status, 'incomplete')
  assert.equal(again.stopped_at, 'upload')
  assert.equal(calls.length, 1)
})

test('--video: a rerun after publish was clicked does not upload the file again', async () => {
  const session = tabStorage()
  const env = studio()
  env.window.sessionStorage = session
  const calls = []
  const done = await run(env, { ...FULL, video: localVideo(env, calls) })
  assert.ok(env.log.published, JSON.stringify(done))
  assert.ok(session.getItem('cu-youtube-published'))

  // The dialog is gone; the tab is back on the channel's content page.
  const after = createPage({ html: '<div>内容</div>', url: 'https://studio.youtube.com/channel/UC0000000000000000000000/videos' })
  after.window.sessionStorage = session
  const r = await run(after, { ...FULL, video: localVideo(after, calls) })
  assert.equal(r.status, 'publish_clicked')
  assert.match(r.hint, /not uploaded again/)
  assert.equal(after.window.location.href, 'https://studio.youtube.com/channel/UC0000000000000000000000/videos')
  assert.deepEqual(calls, [])
})

test('--video from a chrome-use without file args says to upgrade', async () => {
  const page = createPage({ html: fixture('upload-page.html'), url: UPLOAD_URL })
  const r = await run(page, { ...FULL, video: './clip.mp4' })
  assert.match(r.error, /1\.5\.149/)
  assert.match(r.hint, /chrome-use upgrade/)
})

test('stops on a captcha / identity check', async () => {
  const r = await run(studio({ captcha: true }), FULL)
  assert.match(r.error, /verification/)
})

// ---- the upload flow -----------------------------------------------------------

test('fills the details while uploading, then does not publish yet', async () => {
  const env = studio({ progress: 'uploading' })
  const r = await run(env, FULL)
  assert.equal(r.ok, false)
  assert.equal(r.status, 'uploading')
  assert.equal(r.percent, 27)
  assert.equal(r.url, 'https://youtu.be/AAAAAAAAAAA')
  assert.deepEqual(r.done, ['title', 'description', 'made_for_kids', 'ai_altered', 'tags', 'category', 'language', 'allow_embed'])
  assert.equal(env.st.title, FULL.title)
  assert.equal(env.st.description, FULL.description)
  assert.equal(env.st.kids, false)
  assert.equal(env.st.altered, false)
  assert.deepEqual(env.st.tags, ['Claude Code', 'Codex', 'AI编程'])
  assert.equal(env.st.language, '中文（简体）')
  assert.equal(env.st.embed, true)
  assert.ok(!env.log.clicks.includes('next'))
  assert.ok(!env.log.published)
})

test('re-run after the checks finish goes straight on and publishes', async () => {
  const env = studio({ progress: 'uploading' })
  await run(env, FULL)
  env.setProgress('checked')
  const inserts = env.log.inserts
  const r = await run(env, Object.assign({}, FULL, { visibility: 'public' }))
  // visibility is not part of the details, so the details are not redone
  assert.equal(env.log.inserts, inserts)
  assert.deepEqual(r.done, ['details (verified earlier)', 'visibility'])
  assert.equal(r.ok, true)
  assert.equal(r.status, 'published')
  assert.equal(r.visibility, 'public')
  assert.equal(env.st.visibility, 'PUBLIC')
  assert.deepEqual(env.log.clicks.filter((c) => c === 'next'), ['next', 'next', 'next'])
  assert.ok(env.log.published)
})

test('a private save reports status saved and passes the checks through', async () => {
  const env = studio({ progress: 'checked' })
  const r = await run(env, FULL)
  assert.equal(r.status, 'saved')
  assert.equal(env.st.visibility, 'PRIVATE')
  assert.deepEqual(r.warnings, [])
})

test('reports processing and checking, and waits for the checks by default', async () => {
  for (const [p, status] of [['processing', 'processing'], ['checking', 'checking'], ['slow', 'checking']]) {
    const env = studio({ progress: p })
    const r = await run(env, FULL)
    assert.equal(r.status, status)
    assert.ok(!env.log.published)
  }
  const env = studio({ progress: 'checking' })
  const r = await run(env, Object.assign({}, FULL, { wait_checks: 'false' }))
  assert.equal(r.status, 'saved')
  assert.ok(env.log.published)
  assert.match(r.warnings.join(' '), /Checks: 正在检查/)
})

test('surfaces a copyright finding and the one-time verification notice', async () => {
  const env = studio({ progress: 'copyright', notice: true })
  const r = await run(env, FULL)
  assert.ok(r.warnings.includes('如需提供可点击的外部链接，请先完成一次性验证。'))
  assert.ok(r.warnings.some((w) => /版权/.test(w)))
})

test('a run that finds the dialog on a later step goes back and checks the details', async () => {
  const env = studio({ step: 'REVIEW', st: { kids: false } })
  const r = await run(env, FULL)
  assert.equal(env.log.clicks[0], 'back')
  assert.equal(env.st.title, FULL.title)
  assert.equal(r.status, 'saved')
})

test('does nothing to fields that already hold the values', async () => {
  const env = studio({
    progress: 'uploading',
    st: { title: FULL.title, description: FULL.description, kids: false, altered: false, tags: ['codex', 'Claude Code', 'AI编程'], language: '中文（简体）' },
  })
  await run(env, FULL)
  assert.equal(env.log.inserts, 0)
  assert.deepEqual(env.log.clicks, [])
  assert.deepEqual(env.st.tags, ['codex', 'Claude Code', 'AI编程'])
})

test('category by id suffix, and unknown names list what Studio offers', async () => {
  const env = studio({ progress: 'uploading', st: { category: '教育' } })
  await run(env, Object.assign({}, FULL, { category: 'science' }))
  assert.equal(env.st.category, '科学和技术')
  const r = await run(studio({ progress: 'uploading' }), Object.assign({}, FULL, { language: 'Klingon' }))
  assert.match(r.error, /No language named "Klingon"/)
  assert.match(r.hint, /中文（简体）/)
})

test('ticks an existing playlist and warns about a missing one', async () => {
  const env = studio({ progress: 'uploading' })
  const r = await run(env, Object.assign({}, FULL, { playlist: 'My Playlist' }))
  assert.ok(r.done.includes('playlist'))
  assert.deepEqual(env.st.playlists, ['My Playlist'])
  const env2 = studio({ progress: 'uploading' })
  const r2 = await run(env2, Object.assign({}, FULL, { playlist: 'Nope' }))
  assert.ok(r2.warnings.some((w) => /No playlist named "Nope"/.test(w)))
})

// chrome-use 1.5.253+ hands the adapter args.ui, which sends real pointer and
// key events from the daemon. A stand-in that drives the same fake page.
function fakeUi(env) {
  const { window, document } = env
  const calls = []
  const label = (el) => typeof el === 'string' ? el : (el.getAttribute && (el.getAttribute('name') || el.id)) || el.tagName
  const ui = {
    click: async (el) => {
      calls.push(['click', label(el)])
      if (el.focus) el.focus()
      el.click()
    },
    type: async (el, text, o) => {
      calls.push(['type', text, !!(o && o.clear)])
      if (el.focus) el.focus()
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(el, (o && o.clear ? '' : el.value) + text)
      el.dispatchEvent(new window.Event('input', { bubbles: true }))
    },
    // Through the harness's execCommand, which holds the select-all state.
    typeHere: async (text) => { calls.push(['typeHere', text]); document.execCommand('insertText', false, text) },
    press: async (key, o) => {
      calls.push(['press', key, (o && o.repeat) || 1])
      if (key === 'Mod+a') document.execCommand('selectAll')
      else if (key === 'Backspace') document.execCommand('insertText', false, '')
      else if (key === 'Enter' || key === 'Escape') {
        const target = key === 'Enter' ? document.activeElement : document.body
        target.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }))
      }
    },
  }
  return { ui, calls }
}

test('with args.ui every click and keystroke goes through it, with the same result', async () => {
  const env = studio({ progress: 'uploading', st: { description: 'an old description' } })
  const { ui, calls } = fakeUi(env)
  const args = { ...FULL, budgetMs: 600000 }
  Object.defineProperty(args, 'ui', { value: ui, enumerable: false })
  const r = await run(env, args)
  assert.equal(r.status, 'uploading', JSON.stringify(r))
  assert.equal(r.ui_fallbacks, undefined, JSON.stringify(r.ui_fallbacks))
  assert.deepEqual(r.done, ['title', 'description', 'made_for_kids', 'ai_altered', 'tags', 'category', 'language', 'allow_embed'])
  assert.equal(env.st.title, FULL.title)
  assert.equal(env.st.description, FULL.description)
  assert.equal(env.st.kids, false)
  assert.equal(env.st.altered, false)
  assert.deepEqual(env.st.tags, ['Claude Code', 'Codex', 'AI编程'])
  assert.equal(env.st.language, '中文（简体）')
  assert.equal(env.st.embed, true)
  assert.ok(!env.log.published)
  assert.ok(calls.some((c) => c[0] === 'typeHere' && c[1] === FULL.title))
  assert.ok(calls.some((c) => c[0] === 'typeHere' && c[1] === FULL.description))
  assert.ok(calls.some((c) => c[0] === 'press' && c[1] === 'Mod+a'), 'the old text is cleared with select-all')
  assert.deepEqual(calls.filter((c) => c[0] === 'type'), [['type', 'Claude Code', true], ['type', 'Codex', true], ['type', 'AI编程', true]])
  assert.equal(calls.filter((c) => c[0] === 'press' && c[1] === 'Enter').length, 3, 'each tag is entered with a key press')
  assert.ok(calls.some((c) => c[0] === 'click' && c[1] === 'VIDEO_MADE_FOR_KIDS_NOT_MFK'))
  assert.ok(calls.some((c) => c[0] === 'click' && c[1] === 'toggle-button'))
})

test('with args.ui the publish click goes through it too', async () => {
  const env = studio({ progress: 'checked' })
  const { ui, calls } = fakeUi(env)
  const args = { ...FULL, budgetMs: 600000 }
  Object.defineProperty(args, 'ui', { value: ui, enumerable: false })
  const r = await run(env, args)
  assert.equal(r.status, 'saved', JSON.stringify(r))
  assert.equal(r.ui_fallbacks, undefined)
  assert.equal(env.st.visibility, 'PRIVATE')
  assert.equal(calls.filter((c) => c[0] === 'click' && c[1] === 'next-button').length, 3)
  assert.ok(calls.some((c) => c[0] === 'click' && c[1] === 'done-button'))
})

test('a failing args.ui call falls back to synthetic events and says so', async () => {
  const env = studio({ progress: 'checked' })
  const fail = async () => { throw new Error('the element is covered by div.mask') }
  const ui = { click: fail, type: fail, typeHere: fail, press: fail }
  const args = { ...FULL, budgetMs: 600000 }
  Object.defineProperty(args, 'ui', { value: ui, enumerable: false })
  const r = await run(env, args)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.status, 'saved')
  assert.ok(env.log.published)
  assert.equal(env.st.title, FULL.title)
  assert.equal(env.st.description, FULL.description)
  assert.deepEqual(env.st.tags, ['Claude Code', 'Codex', 'AI编程'])
  assert.ok(r.ui_fallbacks.some((f) => /^click: .*covered by div\.mask/.test(f)), JSON.stringify(r.ui_fallbacks))
  assert.ok(r.ui_fallbacks.some((f) => /^title: /.test(f)))
})

test('with args.ui, text too long to type in the time left is inserted instead', async () => {
  const env = studio({ progress: 'uploading' })
  const { ui, calls } = fakeUi(env)
  const description = 'x'.repeat(4000)
  const args = { ...FULL, description, budgetMs: 30000 }
  Object.defineProperty(args, 'ui', { value: ui, enumerable: false })
  const r = await run(env, args)
  assert.equal(r.status, 'uploading', JSON.stringify(r))
  assert.equal(env.st.description, description)
  assert.ok(!calls.some((c) => c[0] === 'typeHere' && c[1] === description))
  assert.ok(calls.some((c) => c[0] === 'typeHere' && c[1] === FULL.title), 'the short title is still typed')
  assert.deepEqual(r.ui_fallbacks, ['description: too long to type in the time left, inserted instead'])
})

test('a step that will not advance ends in incomplete, not a publish', async () => {
  const env = studio({ stuckNext: true })
  const r = await run(env, FULL)
  assert.equal(r.status, 'incomplete')
  assert.equal(r.stopped_at, 'steps')
  assert.ok(!env.log.published)
})

// ---- the edit page ---------------------------------------------------------------

function editPage(current = 'PRIVATE') {
  const page = createPage({
    html: fixture('edit-visibility.html') + fixture('edit-visibility-popup.html') +
      '<ytcp-button id="save" disabled="" aria-disabled="true">保存</ytcp-button>',
    url: EDIT_URL,
  })
  const { body, document } = page
  const popup = body.querySelector('ytcp-video-visibility-edit-popup')
  const paper = popup.querySelector('tp-yt-paper-dialog')
  const save = body.querySelector('ytcp-button#save')
  const ok = popup.querySelector('#save-button')
  const log = { saved: null }
  const radios = () => popup.querySelectorAll('tp-yt-paper-radio-button')
  const set = (name) => { for (const r of radios()) r.setAttribute('aria-checked', r.getAttribute('name') === name ? 'true' : 'false') }
  set(current)
  paper.setAttribute('aria-hidden', 'true')
  let picked = current
  body.addEventListener('click', (e) => {
    const t = e.target
    if (t.closest('#select-button')) { paper.removeAttribute('aria-hidden'); return }
    const r = t.closest('tp-yt-paper-radio-button')
    if (r) { picked = r.getAttribute('name'); set(picked); ok.removeAttribute('disabled'); ok.setAttribute('aria-disabled', 'false'); return }
    if (t.closest('#save-button') && !ok.hasAttribute('disabled')) {
      paper.setAttribute('aria-hidden', 'true')
      if (picked !== current) { save.removeAttribute('disabled'); save.setAttribute('aria-disabled', 'false') }
      return
    }
    if (t.closest('#cancel-button')) { paper.setAttribute('aria-hidden', 'true'); return }
    if (t.closest('ytcp-button#save') && !save.hasAttribute('disabled')) {
      log.saved = picked
      setTimeout(() => { save.setAttribute('disabled', ''); save.setAttribute('aria-disabled', 'true') }, 200)
    }
  })
  void document
  return Object.assign(page, { log })
}

test('on a video\'s edit page, changes its visibility and saves', async () => {
  const env = editPage('PRIVATE')
  const r = await run(env, { visibility: 'public', title: 'ignored' })
  assert.equal(r.ok, true)
  assert.equal(r.status, 'visibility_changed')
  assert.equal(r.from, 'PRIVATE')
  assert.equal(r.url, 'https://youtu.be/AAAAAAAAAAA')
  assert.equal(env.log.saved, 'PUBLIC')
  assert.match(r.warnings[0], /ignored: title/)
})

test('on the edit page, the same visibility is a no-op', async () => {
  const env = editPage('PUBLIC')
  const r = await run(env, { visibility: 'public' })
  assert.equal(r.status, 'unchanged')
  assert.equal(env.log.saved, null)
})

// ---- packaging -------------------------------------------------------------------

test('install.sh ships every youtube-studio adapter in this directory', () => {
  const install = fs.readFileSync(new URL('../install.sh', import.meta.url), 'utf8')
  const onDisk = fs.readdirSync(new URL('.', import.meta.url)).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
  const missing = onDisk.filter((f) => !install.includes('youtube-studio/' + f))
  assert.deepEqual(missing, [], 'these adapters exist but install.sh will not fetch them: ' + missing.join(', '))
  const listed = [...install.matchAll(/youtube-studio\/([\w.-]+\.js)/g)].map((m) => m[1])
  assert.deepEqual(listed.filter((f) => !onDisk.includes(f)), [], 'install.sh lists files that do not exist')
})


test('public publishing stops for thumbnail review by default', async () => {
  const p = studio()
  const r = await run(p, { ...FULL, visibility: 'public', 'cover-mode': '' })
  assert.equal(r.status, 'cover_selection_required')
  assert.equal(p.log.published, false)
})

test('an image file is attached only to the thumbnail input and its preview is confirmed', async () => {
  const p = studio()
  const attached = []
  const file = { name: 'cover.png', size: 100, setOn: async target => {
    const input = typeof target === 'string' ? p.document.querySelector(target) : target
    assert.equal(typeof target, 'string', 'released hosts use the known selector instead of broken element delivery')
    attached.push(input)
    const image = p.dialog.querySelector('ytcp-video-custom-still-editor .preview img')
    image.setAttribute('src', 'blob:verified-cover')
    image.closest('.preview').removeAttribute('hidden')
  } }
  const r = await run(p, { ...FULL, 'cover-mode': 'upload', cover: file })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(attached.length, 1)
  assert.equal(attached[0].getAttribute('accept'), 'image/jpeg,image/png')
  assert.ok(r.done.includes('cover'))
})

test('attachment without a confirmed thumbnail preview does not publish', async () => {
  const p = studio()
  const r = await run(p, { ...FULL, 'cover-mode': 'upload', cover: { name: 'cover.png', size: 100, setOn: async () => {} } })
  assert.equal(r.status, 'cover_confirmation_required')
  assert.equal(p.log.published, false)
})


test('a video file cannot be sent to the thumbnail input', async () => {
  const p = studio()
  let attached = false
  const r = await run(p, { ...FULL, 'cover-mode': 'upload', cover: { name: 'clip.mp4', setOn: async () => { attached = true } } })
  assert.match(r.error, /JPG or PNG/)
  assert.equal(attached, false)
  assert.equal(p.log.published, false)
})

test('a supplied cover cannot be silently ignored by keep mode', async () => {
  const p = studio()
  const r = await run(p, { ...FULL, cover: { name: 'cover.png', setOn: async () => {} } })
  assert.match(r.error, /conflicts with/)
  assert.equal(p.log.published, false)
})


test('hosts advertising element relay delivery can use the private input handle', async () => {
 const p=studio();let passed
 const cover={name:'cover.png',size:100,elementRelayUpload:true,setOn:async target=>{passed=target;const image=p.dialog.querySelector('ytcp-video-custom-still-editor .preview img');image.setAttribute('src','blob:modern-cover');image.closest('.preview').removeAttribute('hidden')}}
 const r=await run(p,{...FULL,'cover-mode':'upload',cover});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(typeof passed,'object');assert.equal(passed.getAttribute('type'),'file');assert.equal(passed.getAttribute('accept'),'image/jpeg,image/png')
})

test('an old CLI cannot start a video upload when local frame preprocessing is missing',async()=>{
 const r=await load({window:{},document:{}})({'cover-mode':'frame:1.5',video:{setOn:async()=>{throw Error('must not attach')}}})
 assert.equal(r.status,'unsupported_cli')
})
