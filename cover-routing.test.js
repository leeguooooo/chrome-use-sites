import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
for(const pack of ['bilibili-creator','douyin-creator']) {
 test(pack+' publisher never silently ignores a supplied cover in keep mode',async()=>{
  const source=readFileSync(new URL('./'+pack+'/video-publish.js',import.meta.url),'utf8')
  const forbidden=new Proxy({},{get(){throw Error('page must not be touched')}})
  const run=new Function('window','document',`return (${source})`)(forbidden,forbidden)
  for(const name of ['cover','cover-portrait','cover-landscape','cover-video','cover-output','allow-dark-cover']){
   const r=await run({'cover-mode':'keep',[name]:'provided'})
   assert.equal(r.status,'cover_mode_conflict');assert.match(r.error,new RegExp(pack+'/cover-select'))
  }
 })
}
