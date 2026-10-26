/* @meta
{
  "name": "douyin-creator/cover-select",
  "description": "Upload and confirm separate portrait 3:4 and landscape 4:3 covers on a prepared new Douyin video form. Never publishes or changes an existing work",
  "timeout": 90,
  "domain": "creator.douyin.com",
  "args": {
    "cover-portrait": {
      "type": "file",
      "required": false,
      "description": "JPG/PNG 3:4 portrait cover"
    },
    "cover-landscape": {
      "type": "file",
      "required": false,
      "description": "JPG/PNG 4:3 landscape cover"
    },
    "cover-mode": {
      "required": false,
      "description": "upload (requires both files), review (default), or keep (explicitly accept both current previews). AI/frame modes are unavailable; frame:<seconds> uses local FFmpeg and requires --cover-video and --cover-output on a compatible CLI"
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
  "example": "chrome-use site douyin-creator/cover-select --cover-portrait ./portrait.png --cover-landscape ./landscape.png --cover-mode upload",
  "coverFrame": {
    "targets": [
      "cover-portrait",
      "cover-landscape"
    ]
  }
}
*/
async function(args) {
  args = args || {}
  const path = String(window.location.pathname || '')
  const query = new URLSearchParams(String(window.location.search || ''))
  if (!/^\/creator-micro\/content\/post\/video\/?$/.test(path) || [...query.keys()].some(k => k !== 'enter_from') || (query.has('enter_from') && query.get('enter_from') !== 'publish_page')) {
    return { error: 'Only a newly uploaded video form is supported; existing works are never changed', status: 'unsupported_page' }
  }
  const portrait = args['cover-portrait'], landscape = args['cover-landscape']
  const mode = String(args['cover-mode'] || (portrait || landscape ? 'upload' : 'review'))
  if (!['upload', 'review', 'keep'].includes(mode)) return { error: 'AI generation and frame selection are not implemented on this editor', status: 'cover_mode_unavailable' }
  if (mode !== 'upload' && (portrait || landscape)) return { error: 'Supplied cover files require upload mode', status: 'cover_mode_conflict' }
  if (mode === 'upload') {
    for (const [name, file] of [['portrait', portrait], ['landscape', landscape]]) {
      if (!file || typeof file.setOn !== 'function' || !/\.(png|jpe?g)$/i.test(String(file.name || ''))) return { error: 'Upload requires both JPG/PNG cover files; missing or invalid ' + name, status: 'invalid_cover' }
      if (file.elementRelayUpload !== true) return { error: 'Upload requires a CLI advertising file.elementRelayUpload', status: 'unsupported_cli' }
    }
    if (!args.ui || typeof args.ui.click !== 'function') return { error: 'Trusted args.ui input is required', status: 'unsupported_cli' }
  }
  const visible = e => {
    if (!e || e.isConnected === false) return false
    for (let p=e;p;p=p.parentElement) if (p.hasAttribute('hidden') || /display\s*:\s*none/.test(p.getAttribute('style') || '')) return false
    return typeof e.getClientRects !== 'function' || e.getClientRects().length > 0
  }
  const modal = () => [...document.querySelectorAll('.dy-creator-content-modal')].find(visible)
  const slots = () => [...document.querySelectorAll('[class^="coverControl-"]')].filter(visible)
  const slot = label => {
    const matches = slots().filter(e => e.textContent.includes(label))
    if (matches.length !== 1) throw new Error('Expected one ' + label + ' cover slot')
    return matches[0]
  }
  const preview = label => {
    const e=slot(label), image=e.querySelector('img')
    return image && image.complete && image.naturalWidth > 0 && image.getAttribute('src') ? { source:image.getAttribute('src'), width:image.naturalWidth, height:image.naturalHeight } : null
  }
  const brief = p => p ? { loaded:true, width:p.width, height:p.height } : { loaded:false }
  const deadline = Date.now() + Math.max(100, Math.min(80000, Number(args.budgetMs) || 65000) - 500)
  const waitFor = async read => {
    const until = Math.min(deadline, Date.now() + 12000)
    for (;;) {
      const value=read(); if(value) return value
      if(Date.now() >= until) return null
      await new Promise(resolve => setTimeout(resolve, 85 + Math.floor(Math.random()*90)))
    }
  }
  let stage='reading the current covers'
  const prepared=[]
  try {
    if (modal()) return { error:'Finish or cancel the open cover editor before starting another operation', status:'cover_confirmation_required' }
    const before={portrait:preview('竖封面'),landscape:preview('横封面')}
    if(mode==='review') return { status:'cover_selection_required', portrait:brief(before.portrait), landscape:brief(before.landscape), published:false }
    if(mode==='keep') return before.portrait && before.landscape ? {ok:true,status:'unchanged',verified:true,portrait:brief(before.portrait),landscape:brief(before.landscape),published:false} : {error:'Both loaded cover previews are required',status:'cover_selection_required'}
    stage='opening the portrait cover editor'
    const target=slot('竖封面').querySelector('[class^="cover-"]')
    if(!target) throw new Error('Cover edit target is missing')
    await args.ui.click(target)
    const editor=await waitFor(modal)
    if(!editor) throw new Error('Cover editor did not open')
    for(const [name,label,file] of [['portrait','竖封面',portrait],['landscape','横封面',landscape]]) {
      const active=editor.querySelector('[class*="step-active-"]')
      if(!active || !active.textContent.includes(label)) throw new Error('The editor opened for the wrong cover ratio')
      // AI reference upload uses the same input classes. Scope by the actual
      // 上传封面 region and require uniqueness before delivering any bytes.
      const regions=[...editor.querySelectorAll('[class^="container-"]')].filter(e=>e.textContent.trim().startsWith('上传封面') && e.querySelectorAll('input.semi-upload-hidden-input[type=file]').length===1)
      if(regions.length!==1) throw new Error('The actual 上传封面 region is not unique')
      const input=regions[0].querySelector('input.semi-upload-hidden-input[type=file]')
      if(!input || !/image\//.test(input.getAttribute('accept') || '')) throw new Error('Image-only cover upload input is missing')
      const canvasId=name==='portrait'?'vertical_coverCanvas_rawImage':'horizontal_coverCanvas_rawImage'
      const fingerprint=()=>{
        const canvas=editor.querySelector('#'+canvasId)
        if(!canvas || !canvas.width || !canvas.height || typeof canvas.toDataURL!=='function') return null
        try {const s=canvas.toDataURL(); return s && s!=='data:,' ? s : null} catch {return null}
      }
      const previous=fingerprint()
      if(!previous) throw new Error('Cannot verify the cover canvas on this editor')
      stage='uploading the '+name+' cover'
      await file.setOn(input)
      if(!(await waitFor(()=>{const current=fingerprint();return current && current!==previous}))) throw new Error('Uploaded cover was not confirmed on the editor canvas; inspect any pending crop')
      prepared.push(name)
      if(name==='portrait') {
        stage='switching to the landscape editor'
        const buttons=[...editor.querySelectorAll('button')].filter(e=>visible(e) && !e.disabled && e.textContent.trim()==='设置横封面')
        if(buttons.length!==1) throw new Error('Landscape step button is not unique')
        await args.ui.click(buttons[0])
        if(!(await waitFor(()=>editor.querySelector('[class*="step-active-"]')?.textContent.includes('横封面')))) throw new Error('Landscape editor did not become active')
      }
    }
    // Both ratios share one editor. Completing the portrait step alone opens
    // a reminder rather than committing the preview, so finish only after both.
    stage='confirming both cover previews'
    const buttons=[...editor.querySelectorAll('button')].filter(e=>visible(e) && !e.disabled && e.textContent.trim()==='完成')
    if(buttons.length!==1) throw new Error('The completion button is not unique')
    await args.ui.click(buttons[0])
    const changed=await waitFor(()=>{
      if(modal()) return null
      const p=preview('竖封面'),l=preview('横封面')
      return p && l && p.source!==before.portrait?.source && l.source!==before.landscape?.source
    })
    if(!changed) throw new Error('Both changed cover previews were not confirmed after completion')
    return {ok:true,status:'covers_selected',verified:true,frame:args.frameCover,portrait:brief(preview('竖封面')),landscape:brief(preview('横封面')),published:false}
  } catch(error) {
    return {error:'Stopped while '+stage+': '+String(error?.message || error),status:'cover_confirmation_required',prepared,published:false,hint:'The form may already contain an uploaded image or a completed cover. Inspect it before retrying; nothing was published or saved.'}
  }
}
