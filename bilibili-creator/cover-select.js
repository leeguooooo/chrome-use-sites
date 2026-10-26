/* @meta
{
  "name": "bilibili-creator/cover-select",
  "description": "Upload one JPG/PNG cover to a new Bilibili video form, verify 4:3 and 16:9 previews and confirm the editor. Never submits or edits an existing work",
  "timeout": 60,
  "domain": "member.bilibili.com",
  "args": {
    "cover": {
      "required": false,
      "type": "file",
      "description": "JPG/PNG image applied to both synchronized cover ratios; requires file.elementRelayUpload"
    },
    "cover-mode": {
      "required": false,
      "description": "upload (default with a file) or review. AI/frame generation and existing-work updates are unavailable; frame:<seconds> uses local FFmpeg and requires --cover-video and --cover-output on a compatible CLI"
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
  "example": "chrome-use site bilibili-creator/cover-select --cover ./cover.png --cover-mode upload",
  "coverFrame": {
    "targets": [
      "cover"
    ]
  }
}
*/
async function(args) {
  args=args||{}
  if(String(window.location.pathname||'')!=='/platform/upload/video/frame' || String(window.location.search||'')) return {error:'Only the new video upload form is supported; existing works are never changed',status:'unsupported_page'}
  const mode=String(args['cover-mode']||(args.cover?'upload':'review'))
  if(!['upload','review'].includes(mode)) return {error:'This adapter supports upload/review, not AI generation, frames or existing-work updates',status:'cover_mode_unavailable'}
  if(mode!=='upload' && args.cover) return {error:'A supplied file requires upload mode',status:'cover_mode_conflict'}
  const file=args.cover
  if(mode==='upload') {
    if(!file || typeof file.setOn!=='function' || !/\.(png|jpe?g)$/i.test(String(file.name||''))) return {error:'A JPG/PNG --cover file is required',status:'invalid_cover'}
    if(file.elementRelayUpload!==true || !args.ui?.click) return {error:'A CLI with relay-safe element upload and trusted args.ui input is required',status:'unsupported_cli'}
  }
  const visible=e=>{
    if(!e || e.isConnected===false)return false
    for(let p=e;p;p=p.parentElement)if(p.hasAttribute('hidden')||/display\s*:\s*none/.test(p.getAttribute('style')||''))return false
    return typeof e.getClientRects!=='function'||e.getClientRects().length>0
  }
  const editor=()=>[...document.querySelectorAll('.cover-editor')].find(visible)
  const source=node=>{
    if(!node)return null
    const src=node.getAttribute('src');if(src)return src
    return String(node.getAttribute('style')||'').match(/url\(\s*(['"]?)(.*?)\1\s*\)/i)?.[2]||null
  }
  const main=()=>source(document.querySelector('.cover-main .cover-img'))
  if(mode==='review')return {status:'cover_selection_required',cover_set:!!main(),published:false,hint:'Review the image before uploading it; upload mode checks both crop previews.'}
  if(editor())return {error:'Finish or cancel the open editor before starting another upload',status:'cover_confirmation_required'}
  const before=main(), deadline=Date.now()+Math.max(100,Math.min(50000,Number(args.budgetMs)||40000)-500)
  const waitFor=async read=>{
    const until=Math.min(deadline,Date.now()+10000)
    for(;;){const x=read();if(x)return x;if(Date.now()>=until)return null;await new Promise(r=>setTimeout(r,80+Math.floor(Math.random()*90)))}
  }
  let stage='opening the cover editor'
  try {
    const targets=[...document.querySelectorAll('.cover-main .cover-empty, .cover-main .cover-img')].filter(visible)
    if(targets.length!==1)throw Error('The current cover control is not unique')
    await args.ui.click(targets[0])
    const e=await waitFor(editor);if(!e)throw Error('The cover editor did not open')
    const sync=[...e.querySelectorAll('.sync .bcc-checkbox')]
    if(sync.length!==2 || sync.some(n=>!n.classList.contains('bcc-checkbox-checked')))throw Error('Enable 双比例同步改动 for both ratios before uploading; no file was delivered')
    const inputs=[...e.querySelectorAll('.cover-upload input[type=file]')]
    if(inputs.length!==1 || !/image\//.test(inputs[0].getAttribute('accept')||''))throw Error('The image-only cover input is not unique')
    const canvasState=()=>['editor_4_3','editor_16_9'].map(id=>{
      const c=e.querySelector('#'+id+' canvas.lower-canvas')
      if(!c || !c.width || !c.height || typeof c.toDataURL!=='function')return null
      try {const value=c.toDataURL();return value&&value!=='data:,'?value:null}catch{return null}
    })
    const old=canvasState();if(old.some(x=>!x))throw Error('Both crop canvases must be readable before upload')
    const previews=()=>['.cover-phone-view-home-video-img img','.cover-phone-view-space-video-img img'].map(sel=>{
      const image=e.querySelector(sel)
      return image?.complete && image.naturalWidth>0 && image.getAttribute('src')?{source:image.getAttribute('src'),width:image.naturalWidth,height:image.naturalHeight}:null
    })
    const oldPreviews=previews()
    stage='uploading the cover image'
    await file.setOn(inputs[0])
    const ready=await waitFor(()=>{
      const now=canvasState(),images=previews()
      if(now.some((v,i)=>!v||v===old[i])||images.some((v,i)=>!v||v.source===oldPreviews[i]?.source))return null
      if(Math.abs(images[0].width/images[0].height-4/3)>0.03 || Math.abs(images[1].width/images[1].height-16/9)>0.03)return null
      return images
    })
    if(!ready)throw Error('Both changed ratio previews were not confirmed; inspect the editor before retrying')
    stage='confirming the editor'
    const done=[...e.querySelectorAll('.cover-editor-button .submit')].filter(visible)
    if(done.length!==1)throw Error('The completion control is not unique')
    await args.ui.click(done[0])
    if(!(await waitFor(()=>!editor() && main() && main()!==before)))throw Error('The new cover on the form was not confirmed after completion')
    return {ok:true,status:'cover_selected',verified:true,frame:args.frameCover,ratios:ready.map((v,i)=>({ratio:i?'16:9':'4:3',width:v.width,height:v.height})),published:false}
  }catch(error){return {error:'Stopped while '+stage+': '+String(error?.message||error),status:'cover_confirmation_required',published:false,hint:'An image may already be attached to the new form. Inspect it before retrying; nothing was submitted or saved.'}}
}
