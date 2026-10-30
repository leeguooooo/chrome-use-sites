/* @meta
{
  "name": "zentao/bugs",
  "description": "禅道 bug 列表：默认是指派给我的；给 product 则按产品列，支持 assigned=self 与状态过滤",
  "domain": "zentao.pwtk.cc",
  "readOnly": true,
  "args": {
    "product": {"required": false, "description": "产品 id；不给就是指派给我的"},
    "status": {"required": false, "description": "all（默认）/ active / resolved / closed"},
    "assigned": {"required": false, "description": "self / all / 禅道账号；不给 product 默认 self，给 product 默认 all"},
    "limit": {"required": false, "description": "最多返回几条，默认 50"}
  }
}
*/
async function(args) {
  const LOGIN = { error: 'login_required', loginRequired: true, loginUrl: '/zentao/user-login.html' };
  const positive = (x) => /^[1-9]\d*$/.test(String(x)) && Number.isSafeInteger(Number(x));
  const product = args.product == null || args.product === '' ? null : String(args.product);
  const limit = args.limit == null || args.limit === '' ? 50 : Number(args.limit);
  const status = args.status || 'all';
  const assigned = args.assigned || (product ? 'all' : 'self');
  if ((product && !positive(product)) || !positive(String(args.limit == null || args.limit === '' ? 50 : args.limit)) || limit < 1 || limit > 10000 || !['all', 'active', 'resolved', 'closed'].includes(status) || !/^[\w.@-]+$/.test(assigned)) return { error: 'bad_arguments', hint: 'product 为正整数；limit 为 1～10000 整数；status 为 all/active/resolved/closed；assigned 为 self/all/账号' };
  const unwrap = (j) => {
    for (let i = 0; i < 3; i++) {
      if (typeof j === 'string') { j = JSON.parse(j); continue; }
      if (j && typeof j === 'object' && !Array.isArray(j) && 'data' in j && !('bugs' in j) && !('profile' in j)) { j = j.data; continue; }
      return j;
    }
    return j;
  };
  const request = async (path) => {
    const r = await fetch(path, { credentials: 'include' });
    if (r.status === 401 || (r.redirected && /user-login/.test(r.url))) return { error: LOGIN };
    let d;
    try { d = unwrap(await r.json()); } catch { return { error: { error: 'invalid_response', status: r.status } }; }
    if (!r.ok || !d || d.error || (d.status && !['success', 'active', 'resolved', 'closed'].includes(d.status))) return { error: { error: 'zentao_error', status: r.status } };
    return { data: d };
  };
  const account = (u) => u && typeof u === 'object' ? String(u.account || '') : String(u || '');
  const who = (u) => u && typeof u === 'object' ? (u.realname || u.account || '') : (u || '');
  let assignee = assigned;
  const mine = !product && assigned === 'self';
  if (assigned === 'self' && !mine) {
    const r = await request('/zentao/api.php/v1/user');
    if (r.error) return r.error;
    assignee = account(r.data.profile || r.data);
    if (!assignee) return { error: 'invalid_response', hint: '当前用户响应缺少 account' };
  }
  const out = [], seen = new Set();
  let sourceTotal = null, complete = false, scanned = 0;
  for (let page = 1; page <= 1000; page++) {
    const query = new URLSearchParams({ status: 'all', page: String(page), limit: '100' });
    if (product) query.set('product', product);
    const r = await request(mine ? '/zentao/my-work-bug-assignedTo-0-id_desc-0-100-' + page + '.json' : '/zentao/api.php/v1/bugs?' + query);
    if (r.error) return r.error;
    const d = r.data;
    let bugs = d.bugs;
    if (!Array.isArray(bugs)) {
      if (!bugs || typeof bugs !== 'object' || !Object.values(bugs).every(b => b && typeof b === 'object' && positive(b.id))) return { error: 'invalid_response', page };
      bugs = Object.values(bugs);
    }
    if (!bugs.every(b => b && positive(b.id) && typeof b.title === 'string' && ['active', 'resolved', 'closed'].includes(b.status))) return { error: 'invalid_response', page };
    const totalValue = d.total ?? d.pager?.recTotal;
    if (totalValue != null) {
      if (!Number.isSafeInteger(Number(totalValue)) || Number(totalValue) < 0) return { error: 'invalid_response', page };
      if (sourceTotal !== null && sourceTotal !== Number(totalValue)) return { error: 'pagination_incomplete', reason: 'total_changed', page, scanned };
      sourceTotal = Number(totalValue);
    }
    if (d.page != null && Number(d.page) !== page) return { error: 'pagination_incomplete', reason: 'page_repeated', page, scanned };
    let added = 0;
    for (const b of bugs) {
      const key = String(b.id);
      if (seen.has(key)) continue;
      seen.add(key); added++; scanned++;
      if (status !== 'all' && b.status !== status) continue;
      if (!mine && assigned !== 'all' && account(b.assignedTo) !== assignee) continue;
      out.push({ id: Number(b.id), title: b.title, status: b.status, severity: Number(b.severity), pri: Number(b.pri), product: b.productName || b.product, productId: Number(typeof b.product === 'object' ? b.product.id : b.product) || null, assignedTo: who(b.assignedTo), assignedToAccount: account(b.assignedTo), openedBy: who(b.openedBy), openedByAccount: account(b.openedBy), openedDate: b.openedDate });
    }
    if ((sourceTotal !== null && scanned >= sourceTotal) || (sourceTotal === null && (Number(d.pager?.pageTotal) === page || bugs.length < Number(d.limit || 100)))) { complete = true; break; }
    if (!added) return { error: 'pagination_incomplete', reason: 'no_progress', page, scanned, sourceTotal };
    if (out.length >= limit) break;
  }
  if (!complete && out.length < limit) return { error: 'pagination_incomplete', reason: 'page_limit', scanned, sourceTotal };
  return { scope: product ? 'product ' + product : mine ? 'assignedToMe' : 'allProducts', assigned, status, count: Math.min(out.length, limit), total: sourceTotal, matchedTotal: complete ? out.length : null, scanned, complete, truncated: !complete || out.length > limit, bugs: out.slice(0, limit) };
}
