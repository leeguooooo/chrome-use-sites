import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {createPage} from '../douyin-creator/fakedom.mjs'
const src=readFileSync(new URL('./cover-select.js',import.meta.url),'utf8'),html=readFileSync(new URL('./fixtures/cover-editor.html',import.meta.url),'utf8')
function setup({sync=true,uploadFails=false,secondChanges=true,mainChanges=true}={}){
 const p=createPage({html,url:'https://member.bilibili.com/platform/upload/video/frame'}),d=p.document,e=d.querySelector('.cover-editor'),clicks=[],uploads=[]
 let changed=false
 if(!sync)e.querySelector('.bcc-checkbox').classList.remove('bcc-checkbox-checked')
 for(const c of e.querySelectorAll('canvas')){c.width=840;c.height=472;c.toDataURL=()=>c.parentElement.id==='editor_16_9'&&!secondChanges?'before':changed?'after':'before'}
 const images=[...e.querySelectorAll('img')];for(let i=0;i<images.length;i++){images[i].complete=true;images[i].naturalWidth=500;images[i].naturalHeight=i?281:375}
 const ui={click:async n=>{clicks.push(n.textContent.trim());if(n.className==='cover-empty')e.setAttribute('style','');else if(n.className.includes('submit')){e.setAttribute('style','display: none');if(mainChanges)d.querySelector('.cover-slot').innerHTML='<div class="cover-img" style="background-image:url(blob:after)"></div>'}else throw Error('unexpected input')}}
 const cover={name:'cover.png',elementRelayUpload:true,setOn:async n=>{uploads.push(n);if(uploadFails)throw Error('delivery unknown');changed=true;for(let i=0;i<images.length;i++)if(!i||secondChanges)images[i].setAttribute('src','blob:after-'+i)}}
 const run=a=>new Function('window','document',`return (${src})`)(p.window,d)({cover,ui,budgetMs:650,...a})
 return {p,e,clicks,uploads,run}
}
test('uploads only the image input and verifies both ratios before completing',async()=>{const f=setup(),r=await f.run({});assert.equal(r.status,'cover_selected',JSON.stringify(r));assert.equal(r.published,false);assert.equal(r.verified,true);assert.deepEqual(r.ratios.map(r=>r.ratio),['4:3','16:9']);assert.deepEqual(f.clicks,['添加封面','完成']);assert.equal(f.uploads[0].getAttribute('accept'),'image/png, image/jpeg')})
test('disabled dual sync refuses before delivery',async()=>{const f=setup({sync:false}),r=await f.run({});assert.equal(r.status,'cover_confirmation_required');assert.deepEqual(f.uploads,[]);assert.ok(!f.clicks.includes('完成'))})
test('unknown delivery or missing second preview cannot complete',async()=>{for(const opts of [{uploadFails:true},{secondChanges:false}]){const f=setup(opts),r=await f.run({});assert.equal(r.status,'cover_confirmation_required');assert.ok(!f.clicks.includes('完成'))}})
test('an ineffective completion is not success',async()=>{const f=setup({mainChanges:false}),r=await f.run({});assert.equal(r.status,'cover_confirmation_required');assert.equal(r.ok,undefined)})
test('review does not open the editor or ignore files',async()=>{const f=setup();assert.equal((await f.run({cover:undefined})).status,'cover_selection_required');assert.deepEqual(f.clicks,[]);assert.equal((await f.run({'cover-mode':'review'})).status,'cover_mode_conflict')})
test('old hosts, invalid images and unsupported modes are refused before input',async()=>{for(const a of [{cover:{name:'a.png',setOn(){}}},{cover:{name:'a.mp4',setOn(){}}},{'cover-mode':'ai'},{'cover-mode':'frame:1'}]){const f=setup();assert.ok((await f.run(a)).error);assert.deepEqual(f.clicks,[])}})
test('existing-work parameters and open editors are refused',async()=>{const f=setup();f.p.window.location.search='?bvid=BV123';assert.equal((await f.run({})).status,'unsupported_page');const g=setup();g.e.setAttribute('style','');assert.equal((await g.run({})).status,'cover_confirmation_required');assert.deepEqual(g.clicks,[])})
