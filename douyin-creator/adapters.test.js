import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { createPage } from './fakedom.mjs'

// douyin-creator/video-publish drives a real creator account (Douyin treats
// scripted behaviour like Xiaohongshu does), so it is exercised here against
// the post page captured in fixtures/ with the editor, topic list, 自主声明
// dialog and buttons stubbed to behave as they did live. The one live check
// was one private draft on a 3 s test clip, discarded straight after. It
// caught the editor typing at a stale caret (text scrambled, topics missed),
// which the fake editor now reproduces: see `selectionPending` in fakedom.mjs.

const fixture = (name) => fs.readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8')
const SRC = fs.readFileSync(new URL('./video-publish.js', import.meta.url), 'utf8')
const POST_URL = 'https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page'
const UPLOAD_URL = 'https://creator.douyin.com/creator-micro/content/upload'

function load(env, fetchImpl) {
  const fetch = fetchImpl || (async () => { throw new Error('the adapter must not fetch without --video_url') })
  return new Function('window', 'document', 'fetch', `return (${SRC})`)(env.window, env.document, fetch)
}

const HEAT = {
  AI编程: fixture('topic-suggestions.html'),
  zqxnotatopic: fixture('topic-suggestions-new.html'),
  ClaudeCode: [['claudecode', '1.2亿'], ['claudecode教程', '3.1万']],
  程序员: [['程序员', '98.1亿'], ['程序员日常', '12.0亿']],
}
const suggestionsHtml = (rows) =>
  '<div class="mention-suggest-item-container-TVOZMl"><div>' +
  rows.map(([n, c]) => `<div class="tag-dVUDkJ tag-hash-o0tpyE"><div><span class="tag-hash-view-tag-DojbdU">#</span><span class="tag-hash-view-name-DwMEe8">${n}</span></div><span class="tag-hash-view-count-juN_70">${c}</span></div>`).join('') +
  '</div></div>'

/**
 * The captured post page with its moving parts wired up:
 *  - the uploader's React state (uploadStatus 2 = done) on a fiber,
 *  - the description editor as a line/chip model re-rendered on each edit,
 *  - the topic list that opens after "#name" and turns a clicked item into a chip,
 *  - the 自主声明 dialog, the 谁可以看 radios, and the 发布 / 暂存离开 buttons.
 */
function postPage({ upload = { uploadStatus: 2, uploadPercent: 0 }, fiber = true, url = POST_URL, onPublish, onDraft, preset } = {}) {
  const page = createPage({ html: fixture('post-video.html'), url })
  const { window, document, body } = page
  const log = { clicks: [], deletes: 0 }

  if (fiber) {
    const host = body.querySelector('[class*="phone-container"]')
    host['__reactFiber$x1'] = { memoizedProps: { className: 'x' }, return: { memoizedProps: { uploader: { state: upload } }, return: null } }
  }

  // ---- editor model ---------------------------------------------------------
  const editor = body.querySelector('.editor-kit-container')
  const lines = [[]] // each line: [{text}|{chip}]
  const lastLine = () => lines[lines.length - 1]
  const lineText = (l) => l.map((s) => s.text ?? '').join('')
  const render = () => {
    editor.innerHTML = lines.map((l) =>
      '<div class="ace-line" data-node="true"><div data-line-wrapper="true" dir="auto">' +
      l.map((s) => s.chip
        ? '<span data-leaf="true"><span data-rect-container="true"><span data-zero-space="true">​</span><span data-fake-text=" " contenteditable="false"><div data-mention="#">&nbsp;<span>#' + s.chip + '</span>&nbsp;</div></span></span></span>'
        : '<span data-leaf="true"><span data-string="true">' + s.text + '</span></span>').join('') +
      '<span data-leaf="true"><span data-string="true" data-enter="true">​</span></span></div></div>').join('')
  }
  const closeList = () => { for (const l of body.querySelectorAll('.mention-suggest-mount-dom')) l.remove() }
  const openList = () => {
    closeList()
    const m = lineText(lastLine()).match(/#([^\s#]+)$/)
    if (!m) return
    const q = m[1]
    setTimeout(() => {
      if (!lineText(lastLine()).endsWith('#' + q)) return
      const rows = HEAT[q]
      if (!rows) return
      const mount = document.parse('<div class="mention-suggest-mount-dom"><div class="mention-suggest-F02Ddw"></div></div>')[0]
      for (const n of document.parse(typeof rows === 'string' ? rows : suggestionsHtml(rows))) mount.children[0].appendChild(n)
      body.appendChild(mount)
    }, 120)
  }
  if (preset) {
    preset(lines)
    render()
  } else render()
  document.execCommand = (cmd, _ui, value) => {
    if (document.activeElement !== editor) return false
    const l = lastLine()
    if (cmd === 'insertText') {
      if (document.selectionPending) {
        // What the live editor did: the text went in at its stale position.
        const first = lines[0]
        if (first[0] && first[0].text != null) first[0].text = value + first[0].text
        else first.unshift({ text: value })
        render()
        return true
      }
      const last = l[l.length - 1]
      if (last && last.text != null) last.text += value
      else l.push({ text: value })
      render()
      openList()
      return true
    }
    if (cmd === 'delete') {
      log.deletes++
      const last = l[l.length - 1]
      if (!last) { if (lines.length > 1) lines.pop() }
      else if (last.chip) l.pop()
      else { last.text = Array.from(last.text).slice(0, -1).join(''); if (!last.text) l.pop() }
      render()
      openList()
      return true
    }
    return false
  }
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); lines.push([]); render() }
  })
  body.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeList() })

  // ---- clicks ---------------------------------------------------------------
  const declRow = () => body.querySelector('[class*="selectText"]')
  let chosen = null
  body.addEventListener('click', (e) => {
    const t = e.target
    const item = t.closest('[class*="tag-hash-o0tpyE"]')
    if (item) {
      const name = item.querySelector('[class*="tag-hash-view-name"]').textContent
      const l = lastLine()
      const last = l[l.length - 1]
      last.text = last.text.replace(/#[^\s#]+$/, '')
      if (!last.text) l.pop()
      l.push({ chip: name }, { text: ' ' })
      closeList()
      render()
      log.clicks.push('topic:' + name)
      return
    }
    if (t.closest('[class*="selectBox"]')) {
      body.appendChild(document.parse(fixture('declaration-modal.html')).find((n) => n.tagName))
      log.clicks.push('declaration-open')
      return
    }
    const modal = t.closest('.semi-modal-wrap')
    if (modal) {
      const radio = t.closest('label')
      if (radio) {
        const label = radio.textContent.trim()
        if (label === '内容为转载信息' && !modal.textContent.includes('取材站外')) {
          modal.remove()
          const repost = document.parse(fixture('declaration-modal-repost.html')).find((n) => n.tagName)
          body.appendChild(repost)
          chosen = label
          return
        }
        if (label !== '取材站内' && label !== '取材站外') chosen = label
        else log.clicks.push('source:' + label)
        for (const b of modal.querySelectorAll('button')) if (b.textContent.trim() === '确定') b.removeAttribute('disabled')
        return
      }
      const btn = t.closest('button')
      if (btn && btn.textContent.trim() === '确定' && !btn.hasAttribute('disabled')) {
        declRow().innerHTML = chosen
        modal.remove()
        log.clicks.push('declaration:' + chosen)
      }
      return
    }
    const label = t.closest('label')
    if (label && label.hasAttribute('data-checked')) {
      for (const sib of label.parentElement.querySelectorAll('label')) sib.setAttribute('data-checked', 'false')
      label.setAttribute('data-checked', 'true')
      log.clicks.push('radio:' + label.textContent.trim())
      return
    }
    const btn = t.closest('button')
    if (btn && btn.textContent.trim() === '发布') {
      log.clicks.push('publish')
      ;(onPublish || (() => { window.location.pathname = '/creator-micro/content/manage' }))(page)
    }
    if (btn && btn.textContent.trim() === '暂存离开') {
      log.clicks.push('draft')
      ;(onDraft || (() => { window.location.href = UPLOAD_URL + '?enter_from=publish' }))(page)
    }
  })

  const state = () => ({
    title: body.querySelector('input[placeholder*="作品标题"]').value,
    lines: lines.map((l) => l.map((s) => (s.chip ? '#' + s.chip + '#' : s.text)).join('')),
    chips: lines.flat().filter((s) => s.chip).map((s) => s.chip),
    declaration: declRow().textContent.trim(),
    visibility: body.querySelectorAll('label[data-checked="true"]').map((l) => l.textContent.trim()),
  })
  return { ...page, log, state }
}

// ---- argument checks ----------------------------------------------------------

test('bad arguments are refused before the page is touched', async () => {
  const p = postPage()
  const run = load(p)
  assert.match((await run({})).error, /Missing argument: title/)
  assert.match((await run({ title: 'x'.repeat(31) })).error, /31 characters; Douyin allows 30/)
  assert.match((await run({ title: 'T', declaration: 'maybe' })).error, /Unknown declaration/)
  assert.match((await run({ title: 'T', visibility: 'everyone' })).error, /Unknown visibility/)
  assert.match((await run({ title: 'T', description: '字'.repeat(1001) })).error, /1000/)
  assert.deepEqual(p.log.clicks, [])
  assert.equal(p.state().title, '')
})

test('not on the post page: says how to upload first', async () => {
  const p = createPage({ html: fixture('upload-page.html'), url: UPLOAD_URL })
  const r = await load(p)({ title: 'T' })
  assert.equal(r.error, 'No video uploaded yet')
  assert.match(r.hint, /chrome-use upload 'input\[type=file\]'/)
})

// ---- upload state ------------------------------------------------------------

test('still uploading: reports progress and fills nothing', async () => {
  const p = postPage({ upload: { uploadStatus: 1, uploadPercent: 42 } })
  const r = await load(p)({ title: 'T', description: 'hello', draft: 'true' })
  assert.equal(r.ok, false)
  assert.equal(r.status, 'uploading')
  assert.equal(r.upload_percent, 42)
  assert.equal(p.state().title, '')
  assert.deepEqual(p.log.clicks, [])
})

test('a failed upload is an error', async () => {
  const p = postPage({ upload: { uploadStatus: -1, uploadPercent: 0 } })
  const r = await load(p)({ title: 'T' })
  assert.match(r.error, /upload failed/)
})

test('without the React uploader it falls back to the preview panel (重新上传 = done)', async () => {
  const p = postPage({ fiber: false })
  const r = await load(p)({ title: 'T', draft: 'true' })
  assert.equal(r.ok, true)
  assert.equal(r.status, 'draft')
})

// ---- the whole form ----------------------------------------------------------

test('draft: fills everything, picks existing topics, skips unknown ones, clicks 暂存离开 only', async () => {
  const p = postPage()
  const r = await load(p)({
    title: '三秒测试',
    description: '第一行\n第二行',
    topics: 'AI编程, ClaudeCode ,zqxnotatopic,#程序员',
    declaration: 'ai',
    visibility: 'private',
    draft: 'true',
  })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.status, 'draft')
  assert.equal(r.url, UPLOAD_URL + '?enter_from=publish')
  assert.match(r.note, /继续编辑/)
  assert.equal(r.title, '三秒测试')
  assert.deepEqual(r.topics, ['AI编程', 'claudecode', '程序员'])
  assert.deepEqual(r.skipped_topics, ['zqxnotatopic'])
  assert.equal(r.declaration, '内容由AI生成')
  assert.equal(r.visibility, '仅自己可见')
  assert.ok(r.warnings.some((w) => /横\/竖双封面缺失/.test(w)), 'the 发文助手 finding is passed on')
  assert.ok(!r.warnings.some((w) => /未见异常/.test(w)))

  const s = p.state()
  assert.equal(s.title, '三秒测试')
  assert.deepEqual(s.lines, ['第一行', '第二行 #AI编程# #claudecode# #程序员# '], 'the unknown topic was typed and taken back out')
  assert.deepEqual(s.chips, ['AI编程', 'claudecode', '程序员'])
  assert.equal(s.declaration, '内容由AI生成')
  assert.ok(s.visibility.includes('仅自己可见') && !s.visibility.includes('公开'))
  assert.ok(p.log.clicks.includes('draft'))
  assert.ok(!p.log.clicks.includes('publish'), 'a draft never clicks 发布')
})

test('publish: 发布 then the content manager; repost is declared 取材站外', async () => {
  const p = postPage()
  const r = await load(p)({ title: 'T', description: 'd', declaration: 'repost' })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.status, 'published')
  assert.equal(r.url, 'https://creator.douyin.com/creator-micro/content/manage?enter_from=publish_page')
  assert.equal(r.visibility, '公开')
  assert.equal(r.declaration, '内容为转载信息')
  assert.ok(p.log.clicks.includes('source:取材站外'))
  assert.ok(p.log.clicks.includes('publish') && !p.log.clicks.includes('draft'))
  assert.ok(!p.log.clicks.some((c) => c.startsWith('radio:')), 'public was already selected')
})

test('a re-run keeps what is already there instead of doubling it', async () => {
  const p = postPage({
    preset: (lines) => { lines[0].push({ text: '已写好的简介 ' }, { chip: 'AI编程' }, { text: ' ' }) },
  })
  const r = await load(p)({ title: 'T', description: '已写好的简介', topics: 'AI编程', draft: 'true' })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.deepEqual(p.state().chips, ['AI编程'])
  assert.equal(p.log.deletes, 0)
  assert.ok(!p.log.clicks.some((c) => c.startsWith('topic:')))
})

test('a different existing description is replaced', async () => {
  const p = postPage({ preset: (lines) => { lines[0].push({ text: 'old text ' }, { chip: '旧话题' }) } })
  const r = await load(p)({ title: 'T', description: 'new', draft: 'true' })
  assert.equal(r.ok, true)
  assert.deepEqual(p.state().lines, ['new'])
  assert.deepEqual(p.state().chips, [])
})

test('a refusal toast after 发布 comes back as the error', async () => {
  const p = postPage({
    onPublish: ({ document, body }) => {
      setTimeout(() => body.appendChild(document.parse('<div class="semi-toast"><span class="semi-toast-content-text">请设置封面后再发布</span></div>')[0]), 150)
    },
  })
  const r = await load(p)({ title: 'T' })
  assert.equal(r.error, 'Douyin refused: 请设置封面后再发布')
})

test('a verification dialog stops the run before any click', async () => {
  const p = postPage()
  p.body.appendChild(p.document.parse('<div class="semi-modal"><div>安全验证 请完成下列验证后继续</div></div>')[0])
  const r = await load(p)({ title: 'T' })
  assert.match(r.error, /verification/)
  assert.deepEqual(p.log.clicks, [])
  assert.equal(p.state().title, '')
})

// ---- --video_url -------------------------------------------------------------

test('--video_url fetches in the page and hands the file to the upload input', async () => {
  const p = createPage({ html: fixture('upload-page.html'), url: UPLOAD_URL })
  const input = p.body.querySelector('input[type="file"]')
  const events = []
  input.addEventListener('change', () => events.push('change'))
  const seen = []
  const fetchStub = async (u) => { seen.push(u); return { ok: true, status: 200, blob: async () => ({ size: 16281, type: 'video/mp4' }) } }
  const r = await load(p, fetchStub)({ video_url: 'https://cdn.example.com/clips/test.mp4?sig=1' })
  assert.equal(r.ok, true)
  assert.equal(r.status, 'upload_started')
  assert.equal(r.file, 'test.mp4')
  assert.deepEqual(seen, ['https://cdn.example.com/clips/test.mp4?sig=1'])
  assert.equal(input.files.length, 1)
  assert.equal(input.files[0].type, 'video/mp4')
  assert.deepEqual(events, ['change'])
})

test('--video_url: a CORS failure explains itself', async () => {
  const p = createPage({ html: fixture('upload-page.html'), url: UPLOAD_URL })
  const r = await load(p, async () => { throw new TypeError('Failed to fetch') })({ video_url: 'https://github.com/o/r/releases/download/v1/a.mp4' })
  assert.match(r.error, /Failed to fetch/)
  assert.match(r.hint, /CORS/)
})

test('--video_url on the post page is refused', async () => {
  const p = postPage()
  const r = await load(p)({ video_url: 'https://cdn.example.com/a.mp4' })
  assert.match(r.error, /already uploaded/)
})

// ---- --video (a local file handed over by chrome-use 1.5.149+) ---------------

// What chrome-use puts in args for a "type": "file" arg. setOn records the
// selector and attaches the file the way `chrome-use upload` would.
const localVideo = (page, calls) => ({
  path: '/abs/clip.mp4',
  name: 'clip.mp4',
  size: 16281,
  setOn: async (selector) => {
    calls.push(selector)
    const input = page.body.querySelector(selector)
    assert.ok(input, 'setOn must name an element that exists: ' + selector)
    input.files = [{ name: 'clip.mp4', size: 16281 }]
    return { attached: 1 }
  },
})
const storage = () => {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }
}

test('--video away from the upload page: opens it and asks to be run again', async () => {
  const p = createPage({ html: '<div>首页</div>', url: 'https://creator.douyin.com/creator-micro/home' })
  const calls = []
  const r = await load(p)({ title: 'T', video: localVideo(p, calls) })
  assert.equal(r.status, 'incomplete')
  assert.equal(r.step, 'open-upload')
  assert.equal(p.window.location.href, UPLOAD_URL)
  assert.deepEqual(calls, [])
})

test('--video on the upload page: hands the file to the video input once', async () => {
  const p = createPage({ html: fixture('upload-page.html'), url: UPLOAD_URL })
  p.window.sessionStorage = storage()
  const calls = []
  const notes = []
  const args = { title: 'T', video: localVideo(p, calls), progress: (m) => notes.push(m) }
  const r = await load(p)(args)
  assert.equal(r.status, 'incomplete')
  assert.equal(r.step, 'upload')
  assert.equal(r.file, 'clip.mp4')
  assert.equal(calls.length, 1)
  assert.equal(p.body.querySelector('input[type="file"]').files.length, 1)
  assert.deepEqual(notes, ['uploading clip.mp4'])

  // A rerun that still lands on the upload page (slow navigation) must not
  // hand the same file over a second time.
  const again = await load(p)(args)
  assert.equal(again.status, 'incomplete')
  assert.equal(calls.length, 1)
})

test('--video on the post page: the upload is done, the form is filled', async () => {
  const p = postPage()
  const calls = []
  const r = await load(p)({ title: 'Hello', draft: 'true', video: localVideo(p, calls) })
  assert.equal(r.ok, true)
  assert.equal(r.status, 'draft')
  assert.deepEqual(calls, [])
})

test('--video from a chrome-use without file args says to upgrade', async () => {
  const p = createPage({ html: fixture('upload-page.html'), url: UPLOAD_URL })
  const r = await load(p)({ title: 'T', video: './clip.mp4' })
  assert.match(r.error, /1\.5\.149/)
  assert.match(r.hint, /chrome-use upgrade/)
})

test('args.budgetMs lengthens the run budget; without it the 7 s budget stands', () => {
  assert.match(SRC, /args\.budgetMs > 0 \? Math\.max\(7000, args\.budgetMs - 2000\) : 7000/)
})

// ---- packaging -----------------------------------------------------------------

test('install.sh ships every douyin-creator adapter in this repo', () => {
  const install = fs.readFileSync(new URL('../install.sh', import.meta.url), 'utf8')
  const onDisk = fs.readdirSync(new URL('.', import.meta.url)).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
  assert.deepEqual(onDisk.filter((f) => !install.includes('douyin-creator/' + f)), [])
})

test('the adapter drives the page and never calls Douyin APIs itself', () => {
  const src = SRC.replace(/\/\/.*$/gm, '')
  const fetches = src.match(/\bfetch\(/g) || []
  assert.equal(fetches.length, 1, 'the only fetch is the --video_url download')
  assert.ok(!/XMLHttpRequest|a_bogus|X-Bogus|msToken/i.test(src))
})
