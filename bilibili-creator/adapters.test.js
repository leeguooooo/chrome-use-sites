import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { createPage } from '../douyin-creator/fakedom.mjs'

// bilibili-creator/video-publish drives a real creator account, and Bilibili
// is treated like Xiaohongshu: one live check, never a loop. So it is exercised
// here against the 投稿 form captured in fixtures/ (after an upload finished,
// with the three tags Bilibili pre-filled) and the 分区 menu as it opened live,
// with the widgets stubbed to behave as they did on the page. The one live run
// (a real publish, BV1fqad6TET7) caught three things the stubs now reproduce:
// the page root's permanent `risk-captcha-adapt` class, Vue reusing tag chip
// nodes after a removal, and refusals arriving as a `toaster-v2-wrp` toast.
// Its success screen was not captured (the tab was lost right after), so the
// stub only sets `completeBvid`, which is where that run's BV id came from.

const fixture = (name) => fs.readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8')
const SRC = fs.readFileSync(new URL('./video-publish.js', import.meta.url), 'utf8')
const URL_FRAME = 'https://member.bilibili.com/platform/upload/video/frame'

function load(env) {
  const fetch = async () => { throw new Error('the adapter must not fetch') }
  return new Function('window', 'document', 'fetch', `return (${SRC})`)(env.window, env.document, fetch)
}

const ARGS = {
  title: 'ocs：让 Claude Code 和 Codex 互相叫醒',
  description: '第一段\nGitHub：https://github.com/leeguooooo/open-cross-session\n\n最后一行',
  tags: 'Claude Code,编程, AI编程,开源',
  category: '科技 → 计算机技术',
  declaration: 'ai',
}

/**
 * The captured form with its moving parts wired up:
 *  - 创作声明 (bcc-select + the 内容为自制 box, whose state lives on the Vue component),
 *  - 分区 menu (fixtures/category-list.html) opened by the controller,
 *  - tag chips (click removes), 推荐标签 (click adds), the tag input (Enter adds),
 *  - the Quill 简介 editor as a paragraph model,
 *  - 可见范围 radios, the recommended cover frames, and 立即投稿 / 存草稿.
 */
function formPage({ uploading = false, rejectTags = [], onSubmit, noSource = false } = {}) {
  const page = createPage({ html: fixture('upload-form.html'), url: URL_FRAME })
  const { window, document, body } = page
  const log = { clicks: [], typedTags: [] }
  const q = (s) => body.querySelector(s)

  const store = { completeBvid: null, captcha: null }
  q('.submit-container').__vue__ = { $store: { state: store } }

  if (uploading) {
    q('.file-item-content-status').innerHTML = '<div class="file-item-content-status-text"><span class="uploading">上传中 37%</span></div>'
    q('.file-item-content-progress-inner').setAttribute('style', 'width: 37%;')
    q('.file-item-content-progress-inner').className = 'file-item-content-progress-inner'
  }

  // ---- 创作声明 ---------------------------------------------------------------
  const cs = q('.creation-statement-container')
  const vmState = { isAuthChecked: false }
  cs.__vue__ = vmState
  const statementInput = cs.querySelector('.bcc-select-input-inner')
  const listWrap = cs.querySelector('.bcc-select-list-wrap')

  // ---- Quill 简介 ---------------------------------------------------------------
  const editor = q('.desc-container .ql-editor')
  let paras = ['']
  const renderEditor = () => {
    editor.innerHTML = paras.map((p) => '<p>' + (p || '<br>') + '</p>').join('')
    if (paras.join('')) editor.classList.remove('ql-blank')
  }
  document.execCommand = (cmd, _ui, value) => {
    if (document.activeElement !== editor) return false
    if (cmd === 'selectAll') { log.selectAll = true; return true }
    if (cmd === 'delete') { paras = ['']; renderEditor(); return true }
    if (cmd === 'insertText') { paras[paras.length - 1] += value; renderEditor(); return true }
    if (cmd === 'insertParagraph') { paras.push(''); renderEditor(); return true }
    return false
  }
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.keyCode === 13) { paras.push(''); renderEditor() }
  })

  // ---- tags ---------------------------------------------------------------------
  const chipWrap = q('#tag-container .tag-pre-wrp')
  const addChip = (name) => {
    chipWrap.appendChild(document.parse('<div class="label-item-v2-container"><p class="label-item-v2-content">' + name + '</p><svg class="close icon-sprite icon-sprite-off"/></div>')[0])
  }
  const tagInput = q('#tag-container input')
  tagInput.addEventListener('keyup', (e) => {
    if (e.keyCode !== 13) return
    const v = tagInput.value.trim()
    log.typedTags.push(v)
    setTimeout(() => {
      if (rejectTags.includes(v)) {
        body.appendChild(document.parse('<div class="toaster-v2-wrp error"><span>Σ( ° △ °|||) 当前tag为话题专用，不允许自定义添加，可在话题搜索页进行搜索</span></div>')[0])
      } else addChip(v)
      tagInput.value = ''
    }, 100)
  })

  // ---- clicks -------------------------------------------------------------------
  body.addEventListener('click', (e) => {
    const t = e.target
    if (t.closest('.bcc-select-input-wrap')) { listWrap.setAttribute('style', ''); log.clicks.push('statement-open'); return }
    const opt = t.closest('li.bcc-option')
    if (opt) {
      const label = opt.textContent.trim()
      statementInput.value = label
      listWrap.setAttribute('style', 'display: none;')
      log.clicks.push('statement:' + label)
      if (label === '内容为转载') {
        vmState.isAuthChecked = false
        if (!noSource) cs.querySelector('.statement-content').appendChild(document.parse('<div class="reprint-source"><input type="text" placeholder="转载视频请注明来源、时间、地点（例：转自https://www.xxxx.com/yyyy），注明来源会更快地通过审核哦" class="input-val"></div>')[0])
      }
      return
    }
    if (t.closest('.auth-content')) { vmState.isAuthChecked = !vmState.isAuthChecked; log.clicks.push('auth'); return }
    const ctl = t.closest('.video-human-type .select-controller')
    if (ctl) {
      const open = q('.video-human-type .drop-list-v2-container')
      if (open) open.remove()
      else q('.video-human-type .select-container').appendChild(document.parse(fixture('category-list.html'))[0])
      log.clicks.push('zone-toggle')
      return
    }
    const item = t.closest('.drop-list-v2-item')
    if (item) {
      q('.video-human-type .select-item-cont').innerHTML = ' ' + item.getAttribute('title') + ' '
      q('.video-human-type .drop-list-v2-container').remove()
      log.clicks.push('zone:' + item.getAttribute('title'))
      return
    }
    const chip = t.closest('.label-item-v2-container')
    if (chip && chip.closest('#tag-container')) {
      // Like Vue's index-keyed list: the texts shift up and the LAST node goes,
      // so a node list taken before the click is stale afterwards.
      const nodes = body.querySelectorAll('#tag-container .label-item-v2-container')
      const names = nodes.map((n) => n.textContent.trim())
      const i = nodes.indexOf(chip)
      log.clicks.push('untag:' + names[i])
      names.splice(i, 1)
      nodes.slice(0, -1).forEach((n, k) => { n.querySelector('.label-item-v2-content').innerHTML = names[k] })
      nodes[nodes.length - 1].remove()
      return
    }
    const hot = t.closest('.hot-tag-container')
    if (hot) {
      const name = hot.textContent.trim()
      log.clicks.push('hot:' + name)
      if (hot.closest('.tag-wrp').textContent.includes('推荐标签')) addChip(name)
      return
    }
    const radio = t.closest('.check-radio-v2-container')
    if (radio) {
      for (const b of body.querySelectorAll('.vu-only-self .check-radio-v2-box')) b.className = 'check-radio-v2-box'
      radio.querySelector('.check-radio-v2-box').className = 'check-radio-v2-box check-radio-v2-box-checked'
      log.clicks.push('vis:' + radio.querySelector('.check-radio-v2-name').textContent.trim())
      return
    }
    if (t.closest('.img-item-cover')) {
      q('.cover-main .cover-slot').innerHTML = '<img class="cover-img" src="blob:https://member.bilibili.com/cover">'
      log.clicks.push('cover')
      return
    }
    if (t.closest('.submit-add')) {
      log.clicks.push('submit')
      ;(onSubmit || (({ document: d, body: b }) => setTimeout(() => {
        store.completeBvid = 'BV1Ab4y1c7XY'
        const form = b.querySelector('.video-up-app') || b
        form.appendChild(d.parse('<div class="step-success"><div class="success-title">稿件投递成功</div><a href="//www.bilibili.com/video/BV1Ab4y1c7XY">查看稿件</a></div>')[0])
      }, 150)))(page)
      return
    }
    if (t.closest('.submit-draft')) {
      log.clicks.push('draft')
      setTimeout(() => body.appendChild(document.parse('<div class="bcc-message"><span>草稿保存成功</span></div>')[0]), 100)
    }
  })

  // Read what the form holds; the default submit keeps the form in the page
  // (the success screen replaces it only when a test asks for that).
  const state = () => ({
    title: q('.video-title input').value,
    statement: statementInput.value,
    auth: vmState.isAuthChecked,
    zone: q('.video-human-type .select-item-cont').textContent.trim(),
    tags: body.querySelectorAll('#tag-container .tag-pre-wrp .label-item-v2-content').map((p) => p.textContent.trim()),
    desc: paras.join('\n'),
    visibility: body.querySelectorAll('.vu-only-self .check-radio-v2-box-checked').map((b) => b.parentElement.querySelector('.check-radio-v2-name').textContent.trim()),
    source: (body.querySelector('.reprint-source input') || { value: null }).value,
  })
  return { ...page, log, state, store }
}

// ---- argument checks ----------------------------------------------------------

test('bad arguments are refused before the page is touched', async () => {
  const p = formPage()
  const run = load(p)
  assert.match((await run({ tags: 'a' })).error, /Missing argument: title/)
  assert.match((await run({ title: 'x'.repeat(81), tags: 'a' })).error, /81 characters; Bilibili allows 80/)
  assert.match((await run({ title: 'T' })).error, /Missing argument: tags/)
  assert.match((await run({ title: 'T', tags: Array.from({ length: 11 }, (_, i) => 't' + i).join(',') })).error, /11 tags/)
  assert.match((await run({ title: 'T', tags: '字'.repeat(21) })).error, /allows 20/)
  assert.match((await run({ title: 'T', tags: 'a', type: 'original' })).error, /Unknown type/)
  assert.match((await run({ title: 'T', tags: 'a', type: 'repost' })).error, /needs --source/)
  assert.match((await run({ title: 'T', tags: 'a', type: 'repost', source: 'x', declaration: 'ai' })).error, /cannot be combined/)
  assert.match((await run({ title: 'T', tags: 'a', declaration: 'maybe' })).error, /Unknown declaration/)
  assert.match((await run({ title: 'T', tags: 'a', visibility: 'friends' })).error, /Unknown visibility/)
  assert.match((await run({ title: 'T', tags: 'a', description: '字'.repeat(2001) })).error, /2000/)
  assert.deepEqual(p.log.clicks, [])
  assert.equal(p.state().title, '')
})

test('before an upload: says how to upload first', async () => {
  const p = createPage({ html: '<div id="app"><div class="bcc-upload-wrapper"><input type="file" multiple accept=".mp4,.flv"></div></div>', url: URL_FRAME })
  const r = await load(p)({ title: 'T', tags: 'a' })
  assert.equal(r.error, 'No video uploaded yet')
  assert.match(r.hint, /chrome-use upload '\.bcc-upload-wrapper input\[type=file\]'/)
})

// ---- the whole form ----------------------------------------------------------

// ---- --video (a local file handed over by chrome-use 1.5.149+) ---------------

const DROP_ZONE = '<div id="app"><div class="bcc-upload-wrapper"><input type="file" multiple accept=".mp4,.flv"></div></div>'
// What chrome-use puts in args for a "type": "file" arg.
const localVideo = (page, calls, onAttach) => ({
  path: '/abs/clip.mp4',
  name: 'clip.mp4',
  size: 14000000,
  setOn: async (selector) => {
    calls.push(selector)
    const input = page.body.querySelector(selector)
    assert.ok(input, 'setOn must name an element that exists: ' + selector)
    input.files = [{ name: 'clip.mp4' }]
    if (onAttach) onAttach()
    return { attached: 1 }
  },
})

test('--video away from the 投稿 page: opens it and asks to be run again', async () => {
  const p = createPage({ html: '<div id="app">创作中心</div>', url: 'https://member.bilibili.com/platform/home' })
  const calls = []
  const r = await load(p)({ title: 'T', tags: 'a', video: localVideo(p, calls) })
  assert.equal(r.status, 'incomplete')
  assert.equal(r.stopped_at, 'open-upload')
  assert.equal(p.window.location.href, URL_FRAME)
  assert.deepEqual(calls, [])
})

test('--video on the drop zone: hands the file over, then waits for the form', async () => {
  const p = createPage({ html: DROP_ZONE, url: URL_FRAME })
  const calls = []
  const notes = []
  const r = await load(p)({ title: 'T', tags: 'a', video: localVideo(p, calls), progress: (m) => notes.push(m) })
  assert.deepEqual(calls, ['.bcc-upload-wrapper input[type="file"]'])
  assert.equal(p.body.querySelector('input[type="file"]').files.length, 1)
  assert.deepEqual(notes, ['uploading clip.mp4'])
  // The stub never shows the form, so the run stops there and can be rerun.
  assert.equal(r.status, 'incomplete')
  assert.equal(r.stopped_at, 'upload')
})

test('--video: once the form appears the same run goes on to fill it', async () => {
  const p = createPage({ html: DROP_ZONE, url: URL_FRAME })
  const calls = []
  const showForm = () => {
    for (const n of p.document.parse('<div class="video-title"><input type="text" value=""></div>')) p.body.appendChild(n)
  }
  const r = await load(p)({ title: 'T', tags: 'a', video: localVideo(p, calls, showForm) })
  assert.equal(calls.length, 1)
  // Past the upload step: the next thing it needs is the rest of the form,
  // which this minimal stub does not have.
  assert.match(r.error, /创作声明 not found/)
})

test('--video with the form already up: nothing is uploaded again', async () => {
  const p = formPage()
  const calls = []
  const r = await load(p)({ ...ARGS, submit: 'false', video: localVideo(p, calls) })
  assert.deepEqual(calls, [])
  assert.equal(r.ok, true)
})

test('--video from a chrome-use without file args says to upgrade', async () => {
  const p = createPage({ html: DROP_ZONE, url: URL_FRAME })
  const r = await load(p)({ title: 'T', tags: 'a', video: './clip.mp4' })
  assert.match(r.error, /1\.5\.149/)
  assert.match(r.hint, /chrome-use upgrade/)
})

test('publish: fills every field, swaps the pre-filled tags, submits and returns the BV id', async () => {
  const p = formPage()
  const r = await load(p)(ARGS)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.status, 'submitted')
  assert.equal(r.bvid, 'BV1Ab4y1c7XY')
  assert.equal(r.url, 'https://www.bilibili.com/video/BV1Ab4y1c7XY')
  assert.equal(r.statement, '含AI生成内容')
  assert.equal(r.self_made, true)
  assert.equal(r.category, '科技数码')
  assert.ok(r.warnings.some((w) => /科技 → 计算机技术.*科技数码/.test(w)), 'the 分区 fallback is reported')
  assert.deepEqual(r.removed_tags, ['日语MV', '听歌', '流行音乐'])
  assert.deepEqual(r.skipped_tags, [])
  assert.equal(r.cover, 'recommended_frame')

  const s = p.state()
  assert.equal(s.title, ARGS.title)
  assert.equal(s.statement, '含AI生成内容')
  assert.equal(s.auth, true)
  assert.equal(s.zone, '科技数码')
  assert.deepEqual(s.tags, ['Claude Code', '编程', 'AI编程', '开源'])
  assert.equal(s.desc, ARGS.description)
  assert.deepEqual(s.visibility, ['公开可见'])
  assert.ok(p.log.clicks.includes('hot:编程'), '编程 was taken from 推荐标签')
  assert.deepEqual(p.log.typedTags, ['Claude Code', 'AI编程', '开源'])
  assert.ok(p.log.clicks.includes('submit') && !p.log.clicks.includes('draft'))
  // 科技数码 was already selected: the menu is opened, the pick closes it, nothing else.
  assert.ok(!p.log.clicks.some((c) => c.startsWith('vis:')), '公开可见 was already selected')
})

test('a re-run on a filled form changes nothing before submitting', async () => {
  const p = formPage({ uploading: true })
  const r1 = await load(p)(ARGS)
  assert.equal(r1.status, 'uploading', JSON.stringify(r1))
  assert.equal(r1.upload_percent, 37)
  assert.ok(!p.log.clicks.includes('submit'), 'nothing is submitted while uploading')
  const clicks = p.log.clicks.length
  // the upload finishes
  p.body.querySelector('.file-item-content-status').innerHTML = '<div class="file-item-content-status-text"><span class="success">上传完成</span></div>'
  const r2 = await load(p)(ARGS)
  assert.equal(r2.status, 'submitted', JSON.stringify(r2))
  assert.deepEqual(p.log.clicks.slice(clicks), ['submit'], 'the second run only submits')
  assert.equal(p.state().auth, true, 'the 自制 box was not toggled back off')
  const r3 = await load(p)(ARGS)
  assert.equal(r3.status, 'already_submitted')
  assert.equal(r3.bvid, 'BV1Ab4y1c7XY')
})

test('--submit false fills the form and clicks neither button', async () => {
  const p = formPage()
  const r = await load(p)(Object.assign({ submit: 'false' }, ARGS))
  assert.equal(r.status, 'filled', JSON.stringify(r))
  assert.equal(p.state().desc, ARGS.description)
  assert.ok(!p.log.clicks.includes('submit') && !p.log.clicks.includes('draft'))
  const r2 = await load(p)(ARGS)
  assert.equal(r2.status, 'submitted')
})

test('draft, private, repost with a source', async () => {
  const p = formPage()
  const r = await load(p)({ title: 'T', tags: '编程', type: 'repost', source: 'https://example.com/v/1', visibility: 'private', draft: 'true', category: '人工智能' })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.status, 'draft')
  assert.equal(r.statement, '内容为转载')
  assert.equal(r.self_made, false)
  const s = p.state()
  assert.equal(s.source, 'https://example.com/v/1')
  assert.equal(s.zone, '人工智能')
  assert.deepEqual(s.visibility, ['仅自己可见'])
  assert.equal(s.desc, '')
  assert.ok(p.log.clicks.includes('draft') && !p.log.clicks.includes('submit'))
})

test('without a declaration an empty 创作声明 becomes 内容无需标注', async () => {
  const p = formPage()
  const r = await load(p)({ title: 'T', tags: '编程' })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(p.state().statement, '内容无需标注')
  assert.equal(p.state().zone, '科技数码', '分区 kept')
})

test('a tag Bilibili refuses (topic-only, as live) is skipped with its reason; the rest go through', async () => {
  const p = formPage({ rejectTags: ['程序员'] })
  const r = await load(p)({ title: 'T', tags: '程序员,开源' })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.deepEqual(r.skipped_tags, ['程序员 (当前tag为话题专用，不允许自定义添加，可在话题搜索页进行搜索)'])
  assert.deepEqual(p.state().tags, ['开源'])
})

test('an unknown 分区 lists the current names', async () => {
  const p = formPage()
  const r = await load(p)({ title: 'T', tags: '编程', category: '番剧' })
  assert.match(r.error, /No 分区 matches "番剧"/)
  assert.match(r.hint, /科技数码/)
  assert.match(r.hint, /人工智能/)
  assert.ok(!p.log.clicks.includes('submit'))
})

test('repost without a 转载来源 field stops', async () => {
  const p = formPage({ noSource: true })
  const r = await load(p)({ title: 'T', tags: '编程', type: 'repost', source: 'x' })
  assert.match(r.error, /转载来源/)
})

test('a refusal toast after 立即投稿 comes back as the error', async () => {
  const p = formPage({
    onSubmit: ({ document, body }) => setTimeout(() => body.appendChild(document.parse('<div class="bcc-message"><span>请选择封面</span></div>')[0]), 120),
  })
  const r = await load(p)({ title: 'T', tags: '编程' })
  assert.equal(r.error, 'Bilibili refused: 请选择封面')
})

test('a dialog after 立即投稿 is reported, not answered', async () => {
  const p = formPage({
    onSubmit: ({ document, body }) => setTimeout(() => body.appendChild(document.parse('<div class="bcc-dialog__wrap"><div class="bcc-dialog">稿件存在风险 是否继续投稿 <button>继续</button></div></div>')[0]), 120),
  })
  const r = await load(p)({ title: 'T', tags: '编程' })
  assert.equal(r.status, 'dialog')
  assert.match(r.dialog, /稿件存在风险/)
})

test('the page-wide risk-captcha-adapt wrapper is not a captcha', async () => {
  const p = formPage()
  p.body.appendChild(p.document.parse('<div class="risk-captcha-adapt-pc risk-captcha-adapt"><span>权益</span></div>')[0])
  const r = await load(p)({ title: 'T', tags: '编程', submit: 'false' })
  assert.equal(r.status, 'filled', JSON.stringify(r))
})

test('a shown geetest challenge stops the run', async () => {
  const p = formPage()
  p.body.appendChild(p.document.parse('<div class="geetest_panel"><div class="geetest_title">请完成安全验证</div></div>')[0])
  const r = await load(p)({ title: 'T', tags: '编程' })
  assert.match(r.error, /verification/)
  assert.deepEqual(p.log.clicks, [])
})

test('a verification dialog stops the run before any click', async () => {
  const p = formPage()
  p.body.appendChild(p.document.parse('<div class="bcc-dialog__wrap"><div class="bcc-dialog">安全验证 请完成验证</div></div>')[0])
  const r = await load(p)({ title: 'T', tags: '编程' })
  assert.match(r.error, /verification/)
  assert.deepEqual(p.log.clicks, [])
  assert.equal(p.state().title, '')
})

// ---- packaging -----------------------------------------------------------------

test('install.sh ships every bilibili-creator adapter in this repo', () => {
  const install = fs.readFileSync(new URL('../install.sh', import.meta.url), 'utf8')
  const onDisk = fs.readdirSync(new URL('.', import.meta.url)).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
  assert.deepEqual(onDisk.filter((f) => !install.includes('bilibili-creator/' + f)), [])
})

test('the adapter drives the page and never calls Bilibili APIs itself', () => {
  const src = SRC.replace(/\/\/.*$/gm, '')
  assert.ok(!/\bfetch\(|XMLHttpRequest|w_rid|wbi|csrf|bili_jct/i.test(src))
  assert.ok(!/\$store\.(commit|dispatch)|\.\$emit\(/.test(src), 'Vue state is only read, never written')
})
