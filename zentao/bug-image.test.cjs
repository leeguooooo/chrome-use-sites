const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(__dirname + '/bug-image.js', 'utf8');
function fixture(options = {}) {
  const calls = [];
  const nodes = [];
  const file = new File(['PNG test'], 'shot.png', { type: 'image/png' });
  const image = {
    name: file.name, size: file.size, elementRelayUpload: true,
    setOn: async input => { if (options.attachFails) throw new Error('delivery failed'); input.files = [file]; },
  };
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes('/api.php/v1/bugs/')) return new Response(JSON.stringify({ id: 42 }));
    if (url === '/zentao/bug-resolve-42.html') return new Response('<form>');
    if (url === '/zentao/file-ajaxUpload-abc.html') {
      if (options.lostReceipt) throw new Error('connection lost');
      return new Response(JSON.stringify({ error: 0, url: options.foreignUrl || '/zentao/file-read-99.png' }));
    }
    if (url.endsWith('/file-read-99.png')) return new Response(options.emptyImage ? '' : 'PNG test', { headers: { 'content-type': 'image/png' } });
    throw new Error('unexpected request ' + url);
  };
  const document = {
    body: { appendChild: input => { input.connected = true; } },
    createElement: tag => {
      assert.equal(tag, 'input');
      const input = { style: {}, connected: false, remove() { this.connected = false; } };
      nodes.push(input);
      return input;
    },
  };
  const DOMParser = class {
    parseFromString() { return { querySelector: selector => ({ getAttribute: key => key === 'value' ? 'abc' : options.badForm ? '/outside-upload' : '/zentao/file-ajaxUpload-abc.html' }) }; }
  };
  const adapter = vm.runInNewContext('(' + source.slice(source.indexOf('async function')) + ')', { fetch, document, DOMParser, FormData, URL, location: { origin: 'https://zentao.pwtk.cc' } });
  return { run: args => adapter({ id: '42', image, ...args }), calls, nodes };
}
test('uploads only the supplied image and verifies persisted image without posting a comment', async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.uploaded, true);
  assert.equal(result.verified, true);
  assert.equal(result.image_url, 'https://zentao.pwtk.cc/zentao/file-read-99.png');
  assert.equal(result.image_uid, 'abc');
  const posts = f.calls.filter(c => c.init.method === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, '/zentao/file-ajaxUpload-abc.html');
  assert.equal(posts[0].init.body.get('imgFile').size, 8);
  assert.ok(f.nodes.every(n => !n.connected));
});
test('rejects malformed bug ids before any request', async () => {
  const f = fixture();
  assert.equal((await f.run({ id: 'bug42' })).error, 'bad_id');
  assert.equal(f.calls.length, 0);
});
test('rejects altered upload endpoints before attaching the local file', async () => {
  const f = fixture({ badForm: true });
  assert.equal((await f.run()).error, 'upload_form_invalid');
  assert.equal(f.nodes.length, 0);
  assert.equal(f.calls.filter(c => c.init.method === 'POST').length, 0);
});
for (const [label, options] of [['lost upload receipt', { lostReceipt: true }], ['foreign uploaded URL', { foreignUrl: 'https://other.example/file-read-99.png' }], ['empty saved image', { emptyImage: true }]]) {
  test(label + ' is an unknown outcome with no automatic retry and no leftover input', async () => {
    const f = fixture(options);
    const result = await f.run();
    assert.equal(result.error, 'action_outcome_unknown');
    assert.equal(result.retryable, false);
    assert.equal(f.calls.filter(c => c.init.method === 'POST').length, 1);
    assert.ok(f.nodes.every(n => !n.connected));
  });
}
test('failed local attachment never starts the remote upload and removes its input', async () => {
  const f = fixture({ attachFails: true });
  assert.equal((await f.run()).error, 'upload_not_started');
  assert.equal(f.calls.filter(c => c.init.method === 'POST').length, 0);
  assert.ok(f.nodes.every(n => !n.connected));
});
