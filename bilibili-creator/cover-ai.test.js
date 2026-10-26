import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {createPage} from '../douyin-creator/fakedom.mjs'
const src=readFileSync(new URL('./cover-ai.js',import.meta.url),'utf8'),html=readFileSync(new URL('./fixtures/cover-ai.html',import.meta.url),'utf8')
function setup({fail=false,deliveryUnknown=false,selectionChanges=true,transformed=false}={}){
 const p=createPage({html,url:'https://member.bilibili.com/platform/upload/video/frame'}),d=p.document,clicks=[]
 const ui={click:async n=>{
  clicks.push(n.className)
  if(n.className==='ai-generate-btn'){
   if(deliveryUnknown)throw Error('delivery unknown')
   if(fail)d.querySelector('.label-text').innerHTML='智能封面生成失败，以下为系统推荐封面'
   else{d.querySelector('.label-text').innerHTML='平台新候选';d.querySelector('.img-item-cover').setAttribute('style','background:url(blob:new-candidate)')}
  }else if(n.className.includes('img-item-cover')&&selectionChanges){n.classList.add('img-item-cover-selected');const url=transformed?'data:image/png;base64,synthetic':n.getAttribute('style').match(/url\(([^)]+)\)/)[1];d.querySelector('.cover-slot').innerHTML='<div class="cover-img" style="background:url('+url+')"></div>'}
  else if(!n.className.includes('img-item-cover'))throw Error('unexpected input')
 }}
 const run=a=>new Function('window','document',`return (${src})`)(p.window,d)({ui,budgetMs:650,...a})
 return {p,d,clicks,run}
}
test('default review returns a screenshot selector and token without choosing a default',async()=>{const f=setup(),r=await f.run({});assert.equal(r.status,'candidates_for_review');assert.equal(r.candidates.length,2);assert.equal(r.candidates[0].source,'blob:candidate-one');assert.match(r.candidate_token,/^[a-f0-9]{64}$/);assert.equal(r.screenshot_selector,'.cover-ai');assert.deepEqual(f.clicks,[])})
test('generation dispatches once and returns new candidates for explicit review',async()=>{const f=setup(),r=await f.run({generate:'true'});assert.equal(r.status,'candidates_for_review');assert.equal(r.generation_outcome,'new_site_candidates_observed');assert.deepEqual(f.clicks,['ai-generate-btn'])})
test('platform AI failure is not reported as a successful generation',async()=>{const f=setup({fail:true}),r=await f.run({generate:'true'});assert.equal(r.status,'ai_generation_failed');assert.equal(r.candidates.length,2);assert.equal(r.published,false);const again=await f.run({generate:'true'});assert.equal(again.generation_attempted,false);assert.deepEqual(f.clicks,['ai-generate-btn'])})
test('uncertain generation input never retries or chooses a candidate',async()=>{const f=setup({deliveryUnknown:true}),r=await f.run({generate:'true'});assert.equal(r.status,'action_outcome_unknown');assert.equal(r.retryable,false);assert.deepEqual(f.clicks,['ai-generate-btn'])})
test('candidate selection binds the exact reviewed sources and label',async()=>{const f=setup(),r=await f.run({});const selected=await f.run({'cover-index':'2','candidate-token':r.candidate_token});assert.equal(selected.status,'candidate_selected');assert.equal(selected.verified,true);assert.equal(selected.requires_crop_review,true);assert.equal(selected.published,false);assert.deepEqual(f.clicks,['img-item-box img-item-cover'])})
test('changed candidates or label invalidate the token before any selection',async()=>{const f=setup(),r=await f.run({});f.d.querySelector('.label-text').innerHTML='new generation';assert.equal((await f.run({'cover-index':'1','candidate-token':r.candidate_token})).status,'stale_candidates');assert.deepEqual(f.clicks,[])})
test('an ineffective selection is not success',async()=>{const f=setup({selectionChanges:false}),r=await f.run({});assert.equal((await f.run({'cover-index':'1','candidate-token':r.candidate_token})).status,'cover_confirmation_required')})
test('generation and selection cannot share one request, and existing-work pages refuse',async()=>{const f=setup();assert.ok((await f.run({generate:'true','cover-index':'1'})).error);assert.deepEqual(f.clicks,[]);f.p.window.location.search='?bvid=BV123';assert.equal((await f.run({})).status,'unsupported_page')})

test('a changed encoded preview plus a unique selected indicator verifies a transformed candidate',async()=>{const f=setup({transformed:true}),r=await f.run({});assert.equal((await f.run({'cover-index':'2','candidate-token':r.candidate_token})).status,'candidate_selected')})
