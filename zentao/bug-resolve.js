/* @meta
{
  "name": "zentao/bug-resolve",
  "description": "解决禅道 bug：resolution 取 fixed / bydesign / postponed / notrepro / willnotfix / tostory / external",
  "domain": "zentao.pwtk.cc",
  "readOnly": false,
  "args": {
    "id": {"required": true, "description": "bug 编号"},
    "resolution": {"required": true, "description": "解决方案，如 fixed"},
    "build": {"required": false, "description": "解决版本，默认 trunk"},
    "to": {"required": false, "description": "解决后指派给谁（通常是提 bug 的 QA）"},
    "comment": {"required": false, "description": "备注，可用 @file"},
    "image_url": {"required": false, "description": "本站截图 URL，来自 bug-image"},
    "image_uid": {"required": false, "description": "bug-image 返回的 uid，与 image_url 一起传"}
  }
}
*/
async function(args) {
  const LOGIN = { error: 'login_required', loginRequired: true, loginUrl: '/zentao/user-login.html' };
  const id = String(args.id);
  const resolutions = ['fixed', 'bydesign', 'postponed', 'notrepro', 'willnotfix', 'tostory', 'external'];
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
  const account = (u) => u && typeof u === 'object' ? String(u.account || '') : String(u || '');
  if (!resolutions.includes(args.resolution) || (args.to && !/^[\w.@-]+$/.test(String(args.to)))) return { error: 'bad_arguments', hint: 'resolution 或 to 无效' };
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
  const requestedBuild = args.build || 'trunk';
  const sameFields = b => b.status === 'resolved' && b.resolution === args.resolution && (!args.to || account(b.assignedTo) === args.to) && b.resolvedBuild === requestedBuild;
  if (sameFields(before) && ((!expectedText && !expectedImages.length) || before.actions.some(a => a.action === 'resolved' && matchesComment(a)))) return { id: Number(id), status: before.status, resolution: before.resolution, assignedTo: account(before.assignedTo), verified: true, unchanged: true };
  if (before.status !== 'active') return { error: 'state_conflict', retryable: false, status: before.status, hint: '工单已解决或关闭；先检查现状，需要补说明请用 bug-comment' };
  const body = { resolution: args.resolution, resolvedBuild: requestedBuild, ...(args.to ? { assignedTo: args.to } : {}), ...(comment ? { comment } : {}), ...(image ? { uid: String(args.image_uid) } : {}) };
  try {
    await fetch('/zentao/api.php/v1/bugs/' + id + '/resolve', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch { return unknown('post_failed'); }
  let result;
  try { result = await read('/zentao/api.php/v1/bugs/' + id); } catch { return unknown('readback_failed'); }
  if (result.error) return unknown('readback_failed');
  const after = result.data;
  if (Number(after.id) !== Number(id) || !Array.isArray(after.actions)) return unknown('invalid_readback');
  const added = after.actions.find(a => a.id != null && !beforeIds.has(String(a.id)) && a.action === 'resolved' && ((!expectedText && !expectedImages.length) || matchesComment(a)));
  if (!sameFields(after) || !added) return unknown('resolution_not_verified');
  return { id: Number(id), status: after.status, resolution: after.resolution, assignedTo: account(after.assignedTo), verified: true, actionId: added.id, ...(image ? { image_url: image.href } : {}) };
}
