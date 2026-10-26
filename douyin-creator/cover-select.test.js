import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {createPage} from './fakedom.mjs'
const source=readFileSync(new URL('./cover-select.js',import.meta.url),'utf8')
const fixture=readFileSync(new URL('./fixtures/cover-editor.html',import.meta.url),'utf8')
function setup({uploadFails=false,canvasChanges=true,previewChanges=true,wrongRatio=false,tainted=false}={}) {
 const p=createPage({html:fixture,url:'https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page'})
 const d=p.document, editor=d.querySelector('.dy-creator-content-modal'),slots=[...d.querySelectorAll('[class^="coverControl-"]')],clicks=[],uploads=[]
 let current=0,stamp=0
 const images=slots.map(e=>e.querySelector('img'))
 for(const image of images){image.complete=true;image.naturalWidth=720;image.naturalHeight=960}
 for(const c of d.querySelectorAll('canvas')){c.width=1192;c.height=682;c.toDataURL=()=>{if(tainted)throw Error('tainted');return 'data:image/png;'+stamp}}
 const ui={click:async e=>{
  clicks.push(e.textContent.trim())
  if(e.className.startsWith('cover-')){current=slots.indexOf(e.parentElement);editor.setAttribute('style','');editor.querySelector('[class*="step-active-"]').innerHTML=wrongRatio?'设置横封面':current?'设置横封面':'设置竖封面'}
  else if(e.textContent==='设置横封面'){current=1;editor.querySelector('[class*="step-active-"]').innerHTML='设置横封面'}
  else if(e.textContent==='完成'){editor.setAttribute('style','display: none');if(previewChanges)for(let i=0;i<2;i++)images[i].setAttribute('src','blob:changed-'+i)}
  else throw Error('Unexpected input')
 }}
 const file=name=>({name:name+'.png',elementRelayUpload:true,setOn:async e=>{uploads.push({name,node:e});if(uploadFails)throw Error('delivery unknown');if(canvasChanges)stamp++}})
 const args={ui,'cover-portrait':file('portrait'),'cover-landscape':file('landscape'),budgetMs:650}
 const run=overrides=>new Function('window','document','URLSearchParams',`return (${source})`)(p.window,p.document,URLSearchParams)({...args,...overrides})
 return {p,editor,args,run,clicks,uploads,images}
}
test('uploads both ratios, confirms their changed previews, and never publishes',async()=>{
 const f=setup(),r=await f.run({});assert.equal(r.status,'covers_selected',JSON.stringify(r));assert.equal(r.verified,true);assert.equal(r.published,false);assert.deepEqual(f.clicks,['选择封面','设置横封面','完成']);assert.deepEqual(f.uploads.map(u=>u.name),['portrait','landscape']);assert.ok(f.uploads.every(u=>u.node.className==='semi-upload-hidden-input' && u.node.parentElement.parentElement.textContent.startsWith('上传封面')))
})
test('review reports both previews without uploading or confirming',async()=>{
 const f=setup(),r=await f.run({'cover-mode':'review','cover-portrait':undefined,'cover-landscape':undefined});assert.equal(r.status,'cover_selection_required');assert.equal(r.portrait.loaded,true);assert.deepEqual(f.clicks,[])
})
test('keep requires both loaded previews',async()=>{
 const f=setup();f.images[1].complete=false;const r=await f.run({'cover-mode':'keep','cover-portrait':undefined,'cover-landscape':undefined});assert.equal(r.status,'cover_selection_required');assert.deepEqual(f.clicks,[])
})
test('supplied files cannot be silently ignored by keep',async()=>{const f=setup(),r=await f.run({'cover-mode':'keep'});assert.equal(r.status,'cover_mode_conflict');assert.deepEqual(f.clicks,[])})
test('both files and the relay capability are required before input',async()=>{
 for(const overrides of [{'cover-landscape':undefined},{'cover-portrait':{name:'bad.mp4',setOn(){}}},{'cover-portrait':{name:'a.png',setOn(){}}}]){const f=setup(),r=await f.run(overrides);assert.ok(['invalid_cover','unsupported_cli'].includes(r.status));assert.deepEqual(f.clicks,[])}
})
test('existing-work identifiers and AI/frame modes are refused',async()=>{
 for(const query of ['?id=123','?enter_from=edit_page','?enter_from=publish_page&aweme_id=123']){const f=setup();f.p.window.location.search=query;assert.equal((await f.run({})).status,'unsupported_page')}
 for(const mode of ['ai','frame:1']){const f=setup();assert.equal((await f.run({'cover-mode':mode})).status,'cover_mode_unavailable');assert.deepEqual(f.clicks,[])}
})
test('an open editor or wrong ratio stops before attaching a file',async()=>{
 const f=setup();f.editor.setAttribute('style','');assert.equal((await f.run({})).status,'cover_confirmation_required');assert.deepEqual(f.clicks,[])
 const g=setup({wrongRatio:true});assert.equal((await g.run({})).status,'cover_confirmation_required');assert.deepEqual(g.uploads,[])
})
test('delivery failure and unchanged or unreadable canvas never complete the cover',async()=>{
 for(const options of [{uploadFails:true},{canvasChanges:false},{tainted:true}]){const f=setup(options),r=await f.run({});assert.equal(r.status,'cover_confirmation_required');assert.equal(r.ok,undefined);assert.ok(!f.clicks.includes('完成'))}
})
test('a dispatched completion without a changed preview is not success',async()=>{
 const f=setup({previewChanges:false}),r=await f.run({});assert.equal(r.status,'cover_confirmation_required');assert.deepEqual(r.prepared,['portrait','landscape']);assert.equal(f.uploads.length,2)
})

test('ambiguous cover upload regions refuse delivery instead of using the AI input',async()=>{
 const f=setup(); const region=f.p.document.querySelector('[class^="container-"]');region.parentElement.appendChild(region.cloneNode(true));const r=await f.run({});assert.equal(r.status,'cover_confirmation_required');assert.deepEqual(f.uploads,[])
})
