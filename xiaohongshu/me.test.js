import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

// xiaohongshu/me on www.xiaohongshu.com: the signed-in user from the Pinia
// store, the counts from the profile page's __INITIAL_STATE__. The state below
// has the shape seen live on 2026-10-09, including the JS-only bits
// (undefined, new Set([])) that make it invalid JSON.

const STATE = `{"user":{"loggedIn":true,"follow":{"pendingIds":new Set([]),"collectedIds":new Set(["a","b"])},"userPageData":{"basicInfo":{"nickname":"大果粒科技","redId":"675265517","gender":0,"ipLocation":"辽宁","desc":"","images":undefined},"interactions":[{"type":"follows","name":"关注","count":"121"},{"type":"fans","name":"粉丝","count":"131"},{"type":"interaction","name":"获赞与收藏","count":"1105","i18nCount":"1.1K"}]},"notes":[[{"id":"n1","xsecToken":"tok=1","noteCard":{"noteId":"n1","displayTitle":"多账号党","type":"normal","interactInfo":{"likedCount":"5","sticky":false}}},{"id":"n2","noteCard":{"noteId":"n2","displayTitle":"东京湾钓点","type":"video","interactInfo":{"likedCount":"25","sticky":true}}}],[],[]]}}`
const PROFILE_HTML = `<html><head></head><body><script>window.__INITIAL_STATE__=${STATE}</script></body></html>`

function load({ user = { userId: 'u1', nickname: 'Nick', guest: false }, fetchImpl, seen = [] } = {}) {
  const src = fs.readFileSync(new URL('./me.js', import.meta.url), 'utf8')
  const store = { userInfo: user }
  const document = {
    querySelector: (sel) =>
      sel === '#app' ? { __vue_app__: { config: { globalProperties: { $pinia: { _s: new Map([['user', store]]) } } } } } : null,
  }
  const fetch = fetchImpl || (async (url) => {
    seen.push(url)
    return { ok: true, status: 200, text: async () => PROFILE_HTML }
  })
  const fastTimeout = (fn) => setTimeout(fn, 0)
  return new Function('document', 'fetch', 'setTimeout', `return (${src})`)(document, fetch, fastTimeout)
}

test('counts and IP location from the profile state, in one request', async () => {
  const seen = []
  const out = await load({ seen })({})
  assert.deepEqual(seen, ['/user/profile/u1'])
  assert.equal(out.nickname, '大果粒科技')
  assert.equal(out.red_id, '675265517')
  assert.equal(out.follows, 121)
  assert.equal(out.fans, 131)
  assert.equal(out.likes_and_collects, 1105)
  assert.equal(out.ip_location, '辽宁')
  assert.equal(out.url, 'https://www.xiaohongshu.com/user/profile/u1')
  assert.equal(out.notes, undefined)
})

test('--notes lists the first page of notes', async () => {
  const out = await load()({ notes: 5 })
  assert.equal(out.notes.length, 2)
  assert.deepEqual(out.notes[0], {
    note_id: 'n1', title: '多账号党', type: 'normal', likes: 5, sticky: false,
    url: 'https://www.xiaohongshu.com/explore/n1?xsec_token=tok%3D1&xsec_source=pc_user',
  })
  assert.equal(out.notes[1].sticky, true)
  assert.equal(out.notes[1].url, 'https://www.xiaohongshu.com/explore/n2')
})

test('guest or signed out is an error, without fetching', async () => {
  const seen = []
  const out = await load({ user: { guest: true }, seen })({})
  assert.match(out.error, /Not logged in/)
  assert.deepEqual(seen, [])
})

test('a page without state says so', async () => {
  const out = await load({ fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<html></html>' }) })({})
  assert.match(out.error, /state not found/)
})
