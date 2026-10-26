/* @meta
{
  "name": "wechat-channels/cover-select",
  "description": "Select an uploaded image as the 3:4 cover on an already prepared WeChat Channels draft form. Confirms crop and editor dialogs and verifies the changed preview; never publishes or edits an existing work",
  "timeout": 60,
  "domain": "channels.weixin.qq.com",
  "args": {
    "cover": {
      "required": false,
      "type": "file",
      "input": ".single-cover-uploader-wrap input[type=file]",
      "description": "Local JPG/PNG cover. Uploaded to the actual input inside the wujie shadow root; requires a CLI build advertising file.elementRelayUpload"
    },
    "cover-mode": {
      "required": false,
      "description": "upload (default with --cover), confirm (accept the current visible crop without uploading again), or keep (read the selected preview). AI and frame selection are explicitly unsupported on this captured editor; frame:<seconds> uses local FFmpeg and requires --cover-video and --cover-output on a compatible CLI"
    },
    "cover-video": {
      "required": false,
      "type": "file",
      "description": "Local source video for --cover-mode frame:<seconds>; extracted locally by the CLI, never attached by this argument"
    },
    "cover-output": {
      "required": false,
      "description": "New PNG path retained for frame review; existing files are never overwritten"
    },
    "allow-dark-cover": {
      "required": false,
      "description": "true explicitly accepts a reviewed near-black or nearly uniform frame; default false stops before browser interaction"
    }
  },
  "capabilities": [
    "dom"
  ],
  "world": "isolated",
  "readOnly": false,
  "example": "chrome-use site wechat-channels/cover-select --cover ./portrait.png --cover-mode upload",
  "coverFrame": {
    "targets": [
      "cover"
    ]
  }
}
*/
async function(args) {
  args = args || {}
  if (!/\/platform\/post\/create\/?$/.test(String(window.location.pathname || '')) || String(window.location.search || '')) {
    return { error: 'cover-select only supports a new draft create form; existing works are never changed' }
  }
  const root = document.querySelector('wujie-app')?.shadowRoot || document
  const wrap = root.querySelector('.cover-preview-wrap')
  if (!wrap) return { error: 'The WeChat Channels cover widget was not found; prepare the video form first' }
  const mode = String(args['cover-mode'] || (args.cover ? 'upload' : 'review'))
  if (!['upload', 'confirm', 'keep'].includes(mode)) return { error: 'This captured editor supports upload, confirm or keep, not AI/frame selection', status: 'cover_mode_unavailable' }
  if (args.cover && mode !== 'upload') return { error: '--cover requires upload mode; confirm/keep cannot silently ignore a supplied file', status: 'cover_mode_conflict' }
  const visible = node => {
    if (!node) return false
    for (let e = node; e; e = e.parentElement) {
      if (e.hasAttribute('hidden') || /display\s*:\s*none/.test(e.getAttribute('style') || '')) return false
    }
    return typeof node.getClientRects !== 'function' || node.getClientRects().length > 0
  }
  const preview = () => wrap.querySelector('.cover-img-vertical')
  const previewValue = () => {
    const image = preview()
    return image && visible(image) && image.getAttribute('src') && image.complete && image.naturalWidth > 0
      ? { source: image.getAttribute('src'), width: image.naturalWidth, height: image.naturalHeight }
      : null
  }
  const before = previewValue()
  if (!before) return { error: 'No loaded video cover preview is available; upload and transcode the test video first' }
  if (mode === 'keep') {
    if (visible(wrap.querySelector('.edit-cover-dialog .weui-desktop-dialog__wrp'))) return { error: 'Finish or cancel the current editor before keeping its preview', status: 'cover_confirmation_required' }
    return { ok: true, status: 'unchanged', verified: true, ratio: '3:4', width: before.width, height: before.height }
  }
  const file = args.cover
  if (mode === 'upload') {
    if (!file || typeof file.setOn !== 'function') return { error: 'Upload mode requires --cover <JPG/PNG> and chrome-use file-argument support' }
    if (!/\.(jpe?g|png)$/i.test(String(file.name || ''))) return { error: 'WeChat cover upload requires a JPG or PNG image' }
    if (file.elementRelayUpload !== true) return { error: 'This CLI lacks relay-safe file.setOn(element) delivery; use a build exposing file.elementRelayUpload before uploading a cover', status: 'unsupported_cli' }
  }
  if (!args.ui || typeof args.ui.click !== 'function') return { error: 'Trusted args.ui input is required; upgrade chrome-use before selecting a cover' }
  const deadline = Date.now() + Math.max(100, (Number(args.budgetMs) || 30000) - 500)
  const waitFor = async (read, maximum) => {
    const until = Math.min(deadline, Date.now() + maximum)
    for (;;) {
      const result = read()
      if (result) return result
      if (Date.now() >= until) return null
      await new Promise(resolve => setTimeout(resolve, 65 + Math.floor(Math.random() * 80)))
    }
  }
  const button = (scope, text) => {
    const matches = [...scope.querySelectorAll('button')].filter(e => visible(e) && !e.disabled && e.getAttribute('aria-disabled') !== 'true' && e.textContent.trim() === text)
    if (matches.length !== 1) throw new Error('Could not uniquely confirm the visible ' + text + ' cover control')
    return matches[0]
  }
  let stage = 'opening the cover editor'
  try {
    // The observed 编辑 label has pointer-events:none; its image wrapper receives input.
    const existing = wrap.querySelector('.edit-cover-dialog .weui-desktop-dialog__wrp')
    if (mode === 'confirm' && !visible(existing)) throw new Error('No visible editor to confirm; inspect the current cover first')
    if (!visible(existing)) {
      const edit = [...wrap.querySelectorAll('.vertical-img-wrap')].filter(visible)
      if (edit.length !== 1) throw new Error('The cover edit button is not unique')
      await args.ui.click(edit[0])
    }
    const outer = await waitFor(() => {
      const e = wrap.querySelector('.edit-cover-dialog .weui-desktop-dialog__wrp')
      return visible(e) ? e : null
    }, 4000)
    if (!outer) throw new Error('The cover editor did not visibly open')
    const uploader = outer.querySelector('.single-cover-uploader-wrap')
    const thumb = () => {
      const image = uploader?.querySelector('img')
      return image && visible(image) && image.complete && image.naturalWidth > 0 ? image.getAttribute('src') : null
    }
    let crop = uploader?.querySelector('.weui-desktop-dialog__wrp')
    if (mode === 'upload') {
      stage = 'uploading the cover image'
      const inputs = [...(uploader?.querySelectorAll('input[type=file]') || [])]
      if (inputs.length !== 1 || !/image\//.test(inputs[0].getAttribute('accept') || '')) throw new Error('The image-only cover input is not unique')
      if (visible(crop)) throw new Error('Finish or cancel the pending crop before selecting another cover')
      const oldThumb = thumb()
      await file.setOn(inputs[0])
      const ready = await waitFor(() => {
        const nested = uploader.querySelector('.weui-desktop-dialog__wrp')
        if (visible(nested)) return { crop: nested }
        const next = thumb()
        return next && next !== oldThumb ? { inline: true } : null
      }, 6000)
      if (!ready) throw new Error('The uploaded cover image could not be confirmed in the editor')
      crop = ready.crop
    }
    // This captured account crops inline; other variants expose the nested
    // 裁剪封面图 dialog. Confirm only a dialog that actually became visible.
    if (visible(crop)) {
      stage = 'confirming the crop'
      await args.ui.click(button(crop, '确定'))
      if (!(await waitFor(() => !visible(crop), 4000))) throw new Error('The crop confirmation did not close')
    }
    stage = 'confirming the cover editor'
    await args.ui.click(button(outer, '确认'))
    const after = await waitFor(() => {
      const value = previewValue()
      return !visible(outer) && value && value.source !== before.source ? value : null
    }, 6000)
    if (!after) throw new Error('The changed cover preview could not be confirmed')
    return { ok: true, status: 'cover_selected', verified: true, frame: args.frameCover, ratio: '3:4', width: after.width, height: after.height, published: false }
  } catch (error) {
    return { error: 'Cover operation stopped while ' + stage + ': ' + String(error?.message || error), status: 'cover_confirmation_required',
      hint: 'The draft may already contain an uploaded/cropped image. Inspect the current preview before retrying; nothing was published.' }
  }
}
