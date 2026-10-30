/* @meta
{
  "name": "zentao/bug-comment",
  "description": "给禅道 bug 加一条备注（以当前登录用户身份）",
  "domain": "zentao.pwtk.cc",
  "readOnly": false,
  "args": {
    "id": {"required": true, "description": "bug 编号"},
    "comment": {"required": true, "description": "备注，可用 @file"},
    "image_url": {"required": false, "description": "本站截图 URL，来自 bug-image"},
    "image_uid": {"required": false, "description": "bug-image 返回的 uid，与 image_url 一起传"}
  }
}
*/
async function(args) {
  const LOGIN = { error: 'login_required', loginRequired: true, loginUrl: '/zentao/user-login.html' };
  const id = String(args.id);
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return { error: 'bad_arguments', hint: 'id 必须是正整数' };
  const unknown = (reason) => ({ error: 'action_outcome_unknown', retryable: false, id: Number(id), reason, hint: '先读回工单状态和备注，勿直接重试写入' });
  const unwrap = (j) => {
    for (let i = 0; i < 3; i++) {
      if (typeof j === 'string') { j = JSON.parse(j); continue; }
      if (j && typeof j === 'object' && 'data' in j && !('id' in j) && !('profile' in j)) { j = j.data; continue; }
      return j;
    }
    return j;
  };
  const read = async (path) => {
    const r = await fetch(path, { credentials: 'include' });
    if (r.status === 401 || (r.redirected && /user-login/.test(r.url))) return { error: LOGIN };
    let data;
    try { data = unwrap(await r.json()); } catch { return { error: { error: 'invalid_response', status: r.status } }; }
    if (!r.ok || !data || data.error) return { error: { error: 'zentao_error', status: r.status } };
    return { data };
  };
  const textOf = (html) => {
    const d = document.createElement('div');
    d.innerHTML = String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n');
    return d.textContent.replace(/\s+/g, ' ').trim();
  };
  const imageRefs = (html) => {
    const out = [];
    for (const m of String(html || '').matchAll(/<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi)) {
      try { out.push(new URL(m[2].replace(/&amp;/g, '&'), location.origin).href); } catch {}
    }
    return out;
  };
  let comment = args.comment == null ? '' : String(args.comment);
  let image = null;
  if (args.image_url || args.image_uid) {
    try { image = new URL(String(args.image_url), location.origin); } catch { return { error: 'bad_arguments', hint: '图片 URL 无效' }; }
    if (image.origin !== location.origin || image.username || image.password || !/^\/zentao\/file-read-[1-9]\d*\.(png|jpe?g|gif|webp)$/i.test(image.pathname) || image.search || image.hash || !/^[a-zA-Z0-9_-]{1,128}$/.test(String(args.image_uid || ''))) return { error: 'bad_arguments', hint: 'image_url 只接受本站图片；同时提供上传返回的 image_uid' };
    comment += '<p><img src="' + image.pathname + '" alt="Bug screenshot" /></p>';
  }
  const expectedText = textOf(comment), expectedImages = imageRefs(comment);
  const matchesComment = (a) => textOf(a.comment) === expectedText && expectedImages.every(u => imageRefs(a.comment).includes(u));
  if (!expectedText && !image) return { error: 'bad_arguments', hint: 'comment 不能为空' };
  let auth, initial;
  try {
    auth = await read('/zentao/api.php/v1/user');
    if (auth.error) return auth.error;
    if (!String((auth.data.profile || auth.data).account || '')) return { error: 'invalid_response', hint: '当前用户响应缺少 account' };
    initial = await read('/zentao/api.php/v1/bugs/' + id);
  } catch { return { error: 'read_failed', retryable: true }; }
  if (initial.error) return initial.error;
  const before = initial.data;
  if (Number(before.id) !== Number(id) || !Array.isArray(before.actions)) return { error: 'invalid_response' };
  const beforeIds = new Set(before.actions.map(a => String(a.id)));
  try {
    const fields = new URLSearchParams({ comment });
    if (image) fields.set('uid', String(args.image_uid));
    await fetch('/zentao/action-comment-bug-' + id + '.json', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: fields.toString() });
  } catch { return unknown('post_failed'); }
  let result;
  try { result = await read('/zentao/api.php/v1/bugs/' + id); } catch { return unknown('readback_failed'); }
  if (result.error) return unknown('readback_failed');
  const after = result.data;
  if (Number(after.id) !== Number(id) || !Array.isArray(after.actions)) return unknown('invalid_readback');
  const added = after.actions.find(a => a.id != null && !beforeIds.has(String(a.id)) && a.action === 'commented' && matchesComment(a));
  if (!added) return unknown('comment_not_verified');
  return { id: Number(id), commented: true, verified: true, actionId: added.id, date: added.date, ...(image ? { image_url: image.href } : {}) };
}
