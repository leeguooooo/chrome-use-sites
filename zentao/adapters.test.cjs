const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const base = process.env.ADAPTER_DIR || __dirname;
const bug = (id, status = 'active', assignedTo = { account: 'Leo', realname: 'Display' }) => ({ id, title: `Bug ${id}`, status, product: 35, assignedTo, openedBy: { account: 'qa', realname: 'QA' }, severity: 3, pri: 3, actions: [] });
const dom = { createElement() { return { innerHTML: '', get textContent() { return this.innerHTML.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'); } }; } };
async function run(name, args, route) {
 const calls = [];
 const fn = vm.runInNewContext('(' + fs.readFileSync(path.join(base, name + '.js'), 'utf8').replace(/^\/\* @meta[\s\S]*?\*\//, '').trim() + ')', { URL, URLSearchParams, document: dom, location: { origin: 'https://zentao.pwtk.cc' }, fetch: async (url, opts = {}) => { calls.push({ url, opts }); const result = await route(url, opts, calls); if (result instanceof Error) throw result; const status = result.statusCode || 200; const data = result.data === undefined ? result : result.data; return { ok: status >= 200 && status < 300, status, redirected: false, url, json: async () => structuredClone(data), text: async () => typeof data === 'string' ? data : JSON.stringify(data) }; } });
 return { out: JSON.parse(JSON.stringify(await fn(args))), calls };
}
const current = { profile: { account: 'Leo', realname: 'Display' } };
test('product all includes closed and preserves accounts', async () => {
 const { out } = await run('bugs', { product: '35', limit: '1000' }, url => { const q = new URL(url, 'https://zentao.pwtk.cc').searchParams; return { bugs: q.get('status') === 'all' ? [bug(1), bug(2, 'closed')] : [bug(1)], total: q.get('status') === 'all' ? 2 : 1, limit: 100, page: 1 }; });
 assert.equal(out.count, 2); assert.equal(out.bugs[0].assignedToAccount, 'Leo'); assert.equal(out.matchedTotal, 2); assert.equal(out.complete, true);
});
test('product plus self and status filter use account identity', async () => {
 const { out } = await run('bugs', { product: '35', assigned: 'self', status: 'closed' }, url => url.endsWith('/user') ? current : { data: JSON.stringify({ bugs: [bug(1, 'closed'), bug(2, 'closed', { account: 'Other', realname: 'Display' })], total: 2, limit: 100, page: 1 }) });
 assert.deepEqual(out.bugs.map(b => b.id), [1]);
});
test('bad listing arguments do not fetch', async () => {
 for (const args of [{ product: 'abc35' }, { limit: 'NaN' }, { limit: '1.2' }, { status: 'bogus' }]) { const r = await run('bugs', args, () => { throw Error('fetch forbidden'); }); assert.equal(r.out.error, 'bad_arguments'); assert.equal(r.calls.length, 0); }
});
test('pagination repeats return an explicit error', async () => {
 const { out } = await run('bugs', { product: '35', limit: 300 }, () => ({ bugs: [bug(1)], total: 300, limit: 1, page: 1 })); assert.equal(out.error, 'pagination_incomplete');
});
test('limit advertises incomplete scan and unknown matched total', async () => {
 const { out } = await run('bugs', { product: '35', limit: 1 }, () => ({ bugs: [bug(1)], total: 300, limit: 1, page: 1 })); assert.equal(out.count, 1); assert.equal(out.complete, false); assert.equal(out.truncated, true); assert.equal(out.matchedTotal, null);
});
test('unexpected listing shape is not an empty success', async () => { const { out } = await run('bugs', { product: 35 }, () => ({ data: { message: 'oops' } })); assert.equal(out.error, 'invalid_response'); });
test('detail includes comment images and deduplicates step images', async () => {
 const b = { ...bug(5), steps: '<p>A</p><img src="/zentao/file-read-1.png">', actions: [{ id: 7, action: 'commented', comment: '<p>note</p><img src=\'/zentao/file-read-2.jpg\'><img src="https://zentao.pwtk.cc/zentao/file-read-1.png"><img src="https://evil.test/zentao/file-read-3.png">' }] };
 const { out } = await run('bug', { id: 5 }, () => b); assert.deepEqual(out.images.map(i => i.id), [1, 2]); assert.deepEqual(out.actions[0].images.map(i => i.id), [2, 1]); assert.equal(out.actions[0].id, 7);
});
test('strict bug ids reject typos before fetching', async () => { for (const name of ['bug', 'bug-comment', 'bug-resolve']) { const { out, calls } = await run(name, { id: 'oops5', comment: 'ok', resolution: 'fixed' }, () => bug(5)); assert.equal(out.error, 'bad_arguments'); assert.equal(calls.length, 0); } });
test('resolve same desired state makes no write', async () => {
 const b = { ...bug(5, 'resolved', { account: 'qa' }), resolution: 'fixed', resolvedBuild: 'trunk', actions: [{ id: 7, action: 'resolved', comment: '<p>done</p>' }] };
 const r = await run('bug-resolve', { id: 5, resolution: 'fixed', to: 'qa', comment: 'done' }, url => url.endsWith('/user') ? current : b); assert.equal(r.out.unchanged, true); assert.equal(r.calls.filter(c => c.opts.method === 'POST').length, 0);
});
test('resolve checks resolution assignee and exact comment, not only state', async () => {
 let post = false;
 const { out } = await run('bug-resolve', { id: 5, resolution: 'fixed', to: 'qa', comment: 'done' }, (url, opts) => { if (url.endsWith('/user')) return current; if (opts.method === 'POST') { post = true; return {}; } return post ? { ...bug(5, 'resolved', { account: 'Wrong' }), resolution: 'fixed', actions: [{ id: 1, action: 'resolved', comment: 'someone else' }] } : bug(5); }); assert.equal(out.error, 'action_outcome_unknown'); assert.equal(out.retryable, false);
});
test('comment concurrent different comment is not a successful readback', async () => {
 let post = false;
 const { out } = await run('bug-comment', { id: 5, comment: 'ours' }, (url, opts) => { if (url.endsWith('/user')) return current; if (opts.method === 'POST') { post = true; return { result: 'success' }; } return { ...bug(5), actions: post ? [{ id: 1, action: 'commented', comment: 'theirs' }] : [] }; }); assert.equal(out.error, 'action_outcome_unknown'); assert.equal(out.retryable, false);
});
test('comment new action is found with newest-first action order', async () => {
 let post = false;
 const { out } = await run('bug-comment', { id: 5, comment: 'ours' }, (url, opts) => { if (url.endsWith('/user')) return current; if (opts.method === 'POST') { post = true; return { result: 'success' }; } return { ...bug(5), actions: post ? [{ id: 3, action: 'commented', comment: '<p>ours</p>' }, { id: 2, action: 'opened' }] : [{ id: 2, action: 'opened' }] }; }); assert.equal(out.commented, true); assert.equal(out.actionId, 3);
});
test('post network uncertainty is not retried', async () => { const r = await run('bug-comment', { id: 5, comment: 'ours' }, (url, opts) => url.endsWith('/user') ? current : opts.method === 'POST' ? new Error('lost connection') : bug(5)); assert.equal(r.out.error, 'action_outcome_unknown'); assert.equal(r.out.retryable, false); assert.equal(r.calls.filter(c => c.opts.method === 'POST').length, 1); });
test('foreign screenshot URLs are rejected before write', async () => { for (const name of ['bug-comment', 'bug-resolve']) { const r = await run(name, { id: 5, comment: 'ours', resolution: 'fixed', image_url: 'https://evil.test/zentao/file-read-1.png', image_uid: 'abc' }, () => bug(5)); assert.equal(r.out.error, 'bad_arguments'); assert.equal(r.calls.length, 0); } });
test('default assigned list preserves the native self scope and string accounts', async () => {
 const { out, calls } = await run('bugs', {}, () => ({ status: 'success', data: JSON.stringify({ bugs: { 5: { ...bug(5), assignedTo: 'Leo' } }, pager: { recTotal: 1, pageTotal: 1 } }) })); assert.equal(out.scope, 'assignedToMe'); assert.equal(out.bugs[0].assignedToAccount, 'Leo'); assert.equal(out.complete, true); assert.match(calls[0].url, /my-work-bug-assignedTo/);
});
test('a later page error cannot return a partial success', async () => {
 const { out } = await run('bugs', { product: 35, limit: 300 }, url => new URL(url, 'https://zentao.pwtk.cc').searchParams.get('page') === '1' ? { bugs: [bug(5)], total: 3, limit: 1, page: 1 } : { statusCode: 500, data: {} }); assert.equal(out.error, 'zentao_error'); assert.equal(out.bugs, undefined);
});
test('resolve verifies all requested fields and screenshot association', async () => {
 let post = false;
 const url = 'https://zentao.pwtk.cc/zentao/file-read-44.png';
 const r = await run('bug-resolve', { id: 5, resolution: 'fixed', to: 'qa', build: '1.2', comment: 'ours', image_url: url, image_uid: 'abc' }, (u, opts) => {
  if (u.endsWith('/user')) return current;
  if (opts.method === 'POST') { const b = JSON.parse(opts.body); assert.equal(b.uid, 'abc'); assert.match(b.comment, /file-read-44.png/); post = true; return {}; }
  return post ? { ...bug(5, 'resolved', { account: 'qa' }), resolution: 'fixed', resolvedBuild: '1.2', actions: [{ id: 7, action: 'resolved', comment: '<p>ours</p><p><img src="/zentao/file-read-44.png" /></p>' }] } : bug(5);
 }); assert.equal(r.out.verified, true); assert.equal(r.out.image_url, url); assert.equal(r.out.assignedTo, 'qa');
});
test('missing screenshot in readback returns unknown even when text matches', async () => {
 let post = false;
 const r = await run('bug-comment', { id: 5, comment: 'ours', image_url: '/zentao/file-read-44.png', image_uid: 'abc' }, (u, opts) => {
  if (u.endsWith('/user')) return current;
  if (opts.method === 'POST') { assert.equal(new URLSearchParams(opts.body).get('uid'), 'abc'); post = true; return {}; }
  return { ...bug(5), actions: post ? [{ id: 7, action: 'commented', comment: '<p>ours</p>' }] : [] };
 }); assert.equal(r.out.error, 'action_outcome_unknown'); assert.equal(r.out.retryable, false);
});
test('unauthenticated requests never post', async () => {
 for (const name of ['bug-comment', 'bug-resolve']) { const r = await run(name, { id: 5, comment: 'ours', resolution: 'fixed' }, () => ({ statusCode: 401, data: {} })); assert.equal(r.out.loginRequired, true); assert.equal(r.calls.length, 1); }
});
test('post succeeded but readback failed is unknown rather than login-required replay', async () => {
 let post = false;
 const r = await run('bug-resolve', { id: 5, resolution: 'fixed' }, (u, opts) => { if (u.endsWith('/user')) return current; if (opts.method === 'POST') { post = true; return {}; } return post ? { statusCode: 401, data: {} } : bug(5); }); assert.equal(r.out.error, 'action_outcome_unknown'); assert.equal(r.out.loginRequired, undefined); assert.equal(r.out.retryable, false);
});
test('resolve checks the default trunk build rather than any resolved build', async () => {
 let post = false;
 const r = await run('bug-resolve', { id: 5, resolution: 'fixed' }, (u, opts) => { if (u.endsWith('/user')) return current; if (opts.method === 'POST') { post = true; return {}; } return post ? { ...bug(5, 'resolved'), resolution: 'fixed', resolvedBuild: 'unexpected-build', actions: [{ id: 7, action: 'resolved' }] } : bug(5); }); assert.equal(r.out.error, 'action_outcome_unknown');
});
test('detail rejects an unrelated or malformed bug response', async () => {
 for (const b of [{}, bug(6), { ...bug(5), actions: {} }]) { const r = await run('bug', { id: 5 }, () => b); assert.equal(r.out.error, 'invalid_response'); }
});
test('malformed current-user response never permits a mutation', async () => {
 for (const name of ['bug-comment', 'bug-resolve']) { const r = await run(name, { id: 5, resolution: 'fixed', comment: 'ours' }, () => ({})); assert.equal(r.out.error, 'invalid_response'); assert.equal(r.calls.length, 1); }
});

test('duplicate resolution is rejected before writing without a target bug interface', async () => {
 const result = await run('bug-resolve', { id: '42', resolution: 'duplicate' }, () => { throw Error('fetch forbidden'); });
 assert.equal(result.out.error, 'bad_arguments');
 assert.equal(result.calls.length, 0);
});
