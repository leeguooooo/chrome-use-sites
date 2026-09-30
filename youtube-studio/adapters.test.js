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

const run = (env, args) => load(env)(args)
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
