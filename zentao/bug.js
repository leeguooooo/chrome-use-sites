/* @meta
{
  "name": "zentao/bug",
  "description": "读一条禅道 bug：标题、状态、指派、复现步骤纯文本、截图/附件下载地址、评论与流转记录",
  "domain": "zentao.pwtk.cc",
  "readOnly": true,
  "args": {
    "id": {"required": true, "description": "bug 编号，如 8874"}
  }
}
*/
async function(args) {
  // 未登录统一报 loginRequired（chrome-use #479 约定）：运行时据此报 login wall、配了 autoLogin 时自动 auth login --bwu 后重跑
  const LOGIN = { error: 'login_required', loginRequired: true, loginUrl: '/zentao/user-login.html',
    hint: '禅道没登录：chrome-use open https://zentao.pwtk.cc/zentao/user-login.html 再 chrome-use auth login --bwu，然后重跑' };
  const isLoginResp = (r) => r.status === 401 || (r.redirected && /user-login/.test(r.url));
  const signedIn = async () => { const r = await fetch('/zentao/api.php/v1/user', { credentials: 'include' }); return !isLoginResp(r) && r.ok; };
  const id = String(args.id);
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return { error: 'bad_arguments', hint: 'id 必须是正整数' };
  const res = await fetch('/zentao/api.php/v1/bugs/' + id, { credentials: 'include' });
  if (isLoginResp(res)) return LOGIN;
  const b = await res.json().catch(() => null);
  if (!res.ok || !b || b.error) {
    if (!(await signedIn())) return LOGIN;
    return { error: 'zentao_error', status: res.status, data: b };
  }
  if (Number(b.id) !== Number(id) || !['active', 'resolved', 'closed'].includes(b.status) || !Array.isArray(b.actions)) return { error: 'invalid_response' };
  const origin = location.origin;
  const html2text = (h) => {
    const d = document.createElement('div');
    d.innerHTML = String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n');
    return d.textContent.replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  };
  const who = (u) => (u && typeof u === 'object') ? (u.realname || u.account) + (u.account ? ' (' + u.account + ')' : '') : (u || '');
  const imagesOf = (html) => {
    const out = [], seen = new Set();
    for (const match of String(html || '').matchAll(/<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi)) {
      let u;
      try { u = new URL(match[2].replace(/&amp;/g, '&'), origin); } catch { continue; }
      const m = u.pathname.match(/^\/zentao\/file-read-([1-9]\d*)(?:\.[a-z0-9]+)?$/i);
      if (u.origin !== origin || !m || seen.has(m[1])) continue;
      seen.add(m[1]); out.push({ id: Number(m[1]), url: u.href });
    }
    return out;
  };
  const images = imagesOf(b.steps);
  const files = (Array.isArray(b.files) ? b.files : Object.values(b.files || {})).map((f) => ({
    id: Number(f.id), title: f.title, size: Number(f.size || 0),
    url: origin + '/zentao/file-read-' + f.id + (f.extension ? '.' + f.extension : '') ,
  }));
  const actions = (b.actions || []).map((a) => ({
    id: a.id, date: a.date, actor: a.actor, action: a.action,
    images: imagesOf(a.comment),
    ...(a.extra ? { extra: a.extra } : {}),
    ...(a.comment ? { comment: html2text(a.comment) } : {}),
    ...(a.history && a.history.length ? { changes: a.history.map((h) => (h.fieldName || h.field) + ': ' + h.old + ' → ' + h.new) } : {}),
  }));
  const imageIds = new Set(images.map(i => i.id));
  for (const a of actions) for (const i of a.images) if (!imageIds.has(i.id)) { imageIds.add(i.id); images.push(i); }
  return {
    id: b.id, title: b.title, url: origin + '/zentao/bug-view-' + b.id + '.html',
    product: b.productName, module: b.moduleTitle, status: b.status, severity: b.severity, pri: b.pri, type: b.type,
    openedBy: who(b.openedBy), openedDate: b.openedDate, assignedTo: who(b.assignedTo),
    resolvedBy: who(b.resolvedBy), resolution: b.resolution || '',
    steps: html2text(b.steps),
    images, files,
    downloadHint: (images.length || files.length) ? 'chrome-use download-url <url> <本地路径>' : undefined,
    actions,
  };
}
