import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {createPage} from '../douyin-creator/fakedom.mjs'
const source=readFileSync(new URL('./cover-select.js',import.meta.url),'utf8')
const fixture=readFileSync(new URL('./fixtures/cover-editor.html',import.meta.url),'utf8')
function setup({uploadFails=false,previewChanges=true,inline=false}={}){
  const p=createPage({html:'<wujie-app></wujie-app>',url:'https://channels.weixin.qq.com/platform/post/create'})
  const root=p.document.parse('<div>'+fixture+'</div>')[0]
  p.document.querySelector('wujie-app').shadowRoot=root
  const image=root.querySelector('.cover-img-vertical');image.setAttribute('src','blob:before');image.complete=true;image.naturalWidth=720;image.naturalHeight=960
  const outer=root.querySelector('.edit-cover-dialog .weui-desktop-dialog__wrp'),crop=outer.querySelector('.single-cover-uploader-wrap .weui-desktop-dialog__wrp')
  const clicks=[],uploads=[]
  const ui={click:async node=>{
    const label=node.textContent.trim();clicks.push(label)
    if(node.className.includes('vertical-img-wrap'))outer.setAttribute('style','')
    else if(label==='确定')crop.setAttribute('style','display: none;')
    else if(label==='确认'){outer.setAttribute('style','display: none;');if(previewChanges)image.setAttribute('src','blob:after')}
    else throw Error('Unexpected input: '+label)
  }}
  const cover={name:'fixture.png',size:10,elementRelayUpload:true,setOn:async node=>{uploads.push(node);if(uploadFails)throw Error('fixture upload rejected');if(inline){const thumb=p.document.parse('<img class="img-wrap" src="blob:uploaded">')[0];thumb.complete=true;thumb.naturalWidth=960;outer.querySelector('.single-cover-uploader-wrap').appendChild(thumb)}else crop.setAttribute('style','')}}
  const run=args=>new Function('window','document',`return (${source})`)(p.window,p.document)({ui,cover,budgetMs:1100,...args})
  return {p,root,run,clicks,uploads}
}
test('uploads through the observed wujie image input, confirms both dialogs and verifies the preview',async()=>{
 const f=setup(),r=await f.run({});assert.equal(r.status,'cover_selected',JSON.stringify(r));assert.equal(r.verified,true);assert.equal(r.published,false)
 assert.deepEqual(f.clicks,['编辑','确定','确认']);assert.equal(f.uploads.length,1);assert.equal(f.uploads[0].getAttribute('accept'),'image/jpeg,image/jpg,image/png')
})
test('an upload rejection cannot confirm or publish the draft',async()=>{
 const f=setup({uploadFails:true}),r=await f.run({});assert.equal(r.status,'cover_confirmation_required');assert.match(r.error,/upload rejected/);assert.deepEqual(f.clicks,['编辑'])
})
test('a dialog acknowledgement without a changed preview is not a success',async()=>{
 const f=setup({previewChanges:false}),r=await f.run({});assert.equal(r.status,'cover_confirmation_required');assert.equal(r.ok,undefined);assert.match(r.error,/preview/)
})
test('AI and frame modes refuse without silently selecting an arbitrary frame',async()=>{
 for(const mode of ['ai','frame:1']){const f=setup(),r=await f.run({'cover-mode':mode});assert.equal(r.status,'cover_mode_unavailable');assert.deepEqual(f.clicks,[]);assert.deepEqual(f.uploads,[])}
})
test('keep reads the already loaded preview and does not send input',async()=>{
 const f=setup(),r=await f.run({'cover-mode':'keep',cover:undefined,ui:undefined});assert.equal(r.status,'unchanged');assert.equal(r.verified,true);assert.deepEqual(f.clicks,[])
})
test('existing-work pages are refused before any action',async()=>{
 const f=setup();f.p.window.location.pathname='/platform/post/edit';const r=await f.run({});assert.match(r.error,/existing works/);assert.deepEqual(f.clicks,[])
})


test('an already open editor is continued without clicking through its overlay',async()=>{
 const f=setup();f.root.querySelector('.edit-cover-dialog .weui-desktop-dialog__wrp').setAttribute('style','')
 const r=await f.run({});assert.equal(r.status,'cover_selected');assert.deepEqual(f.clicks,['确定','确认']);assert.equal(f.uploads.length,1)
})
test('an existing pending crop is left for the caller to inspect',async()=>{
 const f=setup();f.root.querySelector('.edit-cover-dialog .weui-desktop-dialog__wrp').setAttribute('style','');f.root.querySelector('.single-cover-uploader-wrap .weui-desktop-dialog__wrp').setAttribute('style','')
 const r=await f.run({});assert.equal(r.status,'cover_confirmation_required');assert.match(r.error,/pending crop/);assert.deepEqual(f.clicks,[]);assert.deepEqual(f.uploads,[])
})


test('the inline editor confirms without waiting for a nonexistent nested crop dialog',async()=>{
 const f=setup({inline:true}),r=await f.run({});assert.equal(r.status,'cover_selected');assert.deepEqual(f.clicks,['编辑','确认']);assert.equal(f.uploads.length,1)
})
test('explicit confirm accepts the current visible editor without another upload',async()=>{
 const f=setup();f.root.querySelector('.edit-cover-dialog .weui-desktop-dialog__wrp').setAttribute('style','')
 const r=await f.run({'cover-mode':'confirm',cover:undefined});assert.equal(r.status,'cover_selected');assert.deepEqual(f.clicks,['确认']);assert.deepEqual(f.uploads,[])
})


test('older hosts are refused before opening the editor or sending image bytes',async()=>{
 const f=setup(),r=await f.run({cover:{name:'fixture.png',size:10,setOn:async()=>{throw Error('must not upload')}}});assert.equal(r.status,'unsupported_cli');assert.deepEqual(f.clicks,[]);assert.deepEqual(f.uploads,[])
})
test('a create URL carrying an existing-work query is refused',async()=>{
 const f=setup();f.p.window.location.search='?objectId=fixture';const r=await f.run({});assert.match(r.error,/existing works/);assert.deepEqual(f.clicks,[])
})

test('confirm and keep refuse a supplied file instead of ignoring it',async()=>{
 for (const mode of ['confirm','keep']) {
  const f=setup(),r=await f.run({'cover-mode':mode});assert.equal(r.status,'cover_mode_conflict');assert.deepEqual(f.clicks,[]);assert.deepEqual(f.uploads,[])
 }
})
