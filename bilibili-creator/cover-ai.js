/* @meta
{
  "name": "bilibili-creator/cover-ai",
  "description": "Review Bilibili's rendered cover candidates, explicitly request one AI generation, or select a candidate bound to the last reviewed token. Never publishes",
  "timeout": 90,
  "domain": "member.bilibili.com",
  "args": {
    "generate": {"required": false, "description": "true explicitly clicks AI生成 once, then reports the observed outcome and candidates; default false only reads"},
    "cover-index": {"required": false, "description": "One-based candidate index, used only with the exact candidate-token returned by a previous review"},
    "candidate-token": {"required": false, "description": "SHA-256 token binding the rendered candidate sources and their UI label; stale tokens are refused"}
  },
  "capabilities": ["dom"],
  "world": "isolated",
  "readOnly": false,
  "example": "chrome-use site bilibili-creator/cover-ai --generate true"
}
*/
async function(args) {
  args=args||{}
  if(String(window.location.pathname||'')!=='/platform/upload/video/frame'||String(window.location.search||''))return {error:'Only a new video upload form is supported',status:'unsupported_page'}
  if(args.generate!=null&&!['true','false',true,false].includes(args.generate))return {error:'generate must be true or false'}
  const generate=args.generate===true||args.generate==='true'
  const selecting=args['cover-index']!=null
  if(generate&&selecting)return {error:'Generate and review the candidates before selecting; an old index cannot authorize a new generation',status:'cover_confirmation_required'}
  if(args['candidate-token']&&!selecting)return {error:'candidate-token is used only with cover-index'}
  const visible=e=>{
    if(!e||e.isConnected===false)return false
    for(let p=e;p;p=p.parentElement)if(p.hasAttribute('hidden')||/display\s*:\s*none/.test(p.getAttribute('style')||''))return false
    return typeof e.getClientRects!=='function'||e.getClientRects().length>0
  }
  const area=document.querySelector('.cover-ai')
  if(!area||!visible(area))return {error:'The cover candidate widget is not ready',status:'cover_selection_required'}
  if((generate||selecting)&&typeof args.ui?.click!=='function')return {error:'Trusted args.ui input is required',status:'unsupported_cli'}
  const source=node=>{
    if(!node)return null
    const image=node.querySelector('img')||node
    return image.getAttribute('src')||String(node.getAttribute('style')||'').match(/url\(\s*(['"]?)(.*?)\1\s*\)/i)?.[2]||null
  }
  const current=()=>source(document.querySelector('.cover-main .cover-img'))
  const rows=()=>[...area.querySelectorAll('.img-item-cover')].filter(visible)
  const label=()=>area.querySelector('.label-text')?.textContent.trim()||''
  const candidates=()=>rows().map((node,i)=>({index:i+1,source:source(node)}))
  const token=async (list,title)=>{
    const data=new TextEncoder().encode(JSON.stringify({label:title,candidates:list}))
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(n=>n.toString(16).padStart(2,'0')).join('')
  }
  const result=async(status,extra={})=>{
    const list=candidates(),title=label()
    return {status,candidates:list,candidate_token:await token(list,title),source_label:title,screenshot_selector:'.cover-ai',published:false,...extra}
  }
  const failed=()=>/生成失败/.test(area.textContent)||!![...area.querySelectorAll('.img-item-failed')].find(visible)
  const waitFor=async read=>{
    const end=Date.now()+Math.max(100,Math.min(60000,Number(args.budgetMs)||55000)-500)
    for(;;){const v=read();if(v)return v;if(Date.now()>=end)return null;await new Promise(r=>setTimeout(r,110+Math.floor(Math.random()*140)))}
  }
  if(generate) {
    // A visible failed state is evidence, not permission to retry a potentially
    // metered generation. Listing its fallback candidates remains read-only.
    if(failed())return result('ai_generation_failed',{generation_attempted:false,hint:'The page already reports generation failure. Inspect it; this command will not retry automatically.'})
    const buttons=[...area.querySelectorAll('.ai-generate-btn')].filter(visible)
    if(buttons.length!==1)return result('ai_generation_unavailable',{generation_attempted:false})
    const before=JSON.stringify(candidates())
    try {await args.ui.click(buttons[0])}catch(error){return result('action_outcome_unknown',{retryable:false,generation_attempted:'unknown',error:String(error?.message||error)})}
    const observed=await waitFor(()=>failed()?'failed':rows().length&&JSON.stringify(candidates())!==before?'changed':null)
    if(observed==='failed')return result('ai_generation_failed',{generation_attempted:true,hint:'The platform reports failure. Returned system recommendations are not proof of AI generation; no candidate was chosen.'})
    if(observed==='changed')return result('candidates_for_review',{generation_attempted:true,generation_outcome:'new_site_candidates_observed',hint:'Inspect the screenshot and source label before selecting. Nothing was chosen automatically.'})
    return result('action_outcome_unknown',{retryable:false,generation_attempted:true,hint:'Generation did not reach a recognized outcome. Inspect the page; do not generate again automatically.'})
  }
  if(!selecting)return result(failed()?'ai_generation_failed':'candidates_for_review',{generation_attempted:false})
  const nodes=rows(),list=nodes.map((node,i)=>({index:i+1,source:source(node)})),title=label(),expectedToken=await token(list,title),index=Number(args['cover-index'])
  if(args['candidate-token']!==expectedToken)return result('stale_candidates',{error:'Review the current candidates and use their exact token before selecting'})
  if(!Number.isInteger(index)||index<1||index>list.length||!list[index-1].source)return {error:'cover-index must name a rendered candidate with a known image source',status:'cover_selection_required'}
  const expected=list[index-1].source,chosen=nodes[index-1]
  if(!visible(chosen)||source(chosen)!==expected||label()!==title)return result('stale_candidates',{error:'The reviewed candidate changed before input'})
  const before=current()
  const chosenIsUnique=()=>chosen.classList.contains('img-item-cover-selected')&&[...area.querySelectorAll('.img-item-cover-selected')].filter(visible).length===1
  if(before&&chosenIsUnique())return {ok:true,status:'candidate_selected',verified:true,already_selected:true,index,source_label:title,requires_crop_review:true,published:false}
  try {await args.ui.click(chosen)}catch(error){return {error:String(error?.message||error),status:'action_outcome_unknown',retryable:false,published:false}}
  const selected=await waitFor(()=>{const after=current();return after&&(after===expected||(after!==before&&chosenIsUnique()))})
  if(!selected)return {error:'The chosen image was not confirmed as the form cover',status:'cover_confirmation_required',retryable:false,published:false}
  return {ok:true,status:'candidate_selected',verified:true,index,source_label:label(),requires_crop_review:true,published:false,hint:'Review 4:3 and 16:9 crops before any publish command. Candidate selection does not publish or verify those crops.'}
}
