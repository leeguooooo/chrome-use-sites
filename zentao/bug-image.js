/* @meta
{
  "name": "zentao/bug-image",
  "description": "上传本地 Bug 截图并验证可读取，返回 image_url 和 image_uid 供备注或 Resolve 使用；不修改工单状态",
  "domain": "zentao.pwtk.cc",
  "readOnly": false,
  "world": "isolated",
  "args": {
    "id": {"required": true, "description": "Bug 编号"},
    "image": {"required": true, "type": "file", "description": "本地 PNG/JPEG/GIF/WebP 截图，最多 10 MB"}
  }
}
*/
async function(args) {
  const id = String(args.id || '');
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return { error: 'bad_id' };
  if (!args.image || typeof args.image.setOn !== 'function') return { error: 'image_required' };
  if (!args.image.elementRelayUpload) return { error: 'unsupported_upload', hint: '升级 chrome-use 后重试' };
  if (!/\.(png|jpe?g|gif|webp)$/i.test(args.image.name || '') || !(args.image.size > 0 && args.image.size <= 10 * 1024 * 1024)) {
    return { error: 'bad_image', hint: '仅支持不超过 10 MB 的 PNG/JPEG/GIF/WebP' };
  }
  const LOGIN = { error: 'login_required', loginRequired: true, loginUrl: '/zentao/user-login.html' };
  const isLogin = r => r.status === 401 || r.redirected && /\/user-login(?:[.-]|$)/.test(new URL(r.url).pathname);
  const bug = await fetch('/zentao/api.php/v1/bugs/' + id, { credentials: 'include' });
  if (isLogin(bug)) return LOGIN;
  const detail = await bug.json().catch(() => null);
  if (!bug.ok || !detail || String(detail.id) !== id) return { error: 'bug_not_found', status: bug.status };
  const form = await fetch('/zentao/bug-resolve-' + id + '.html', {
    credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });
  if (isLogin(form)) return LOGIN;
  if (!form.ok) return { error: 'upload_form_unavailable', status: form.status };
  const doc = new DOMParser().parseFromString(await form.text(), 'text/html');
  const uploadPath = doc.querySelector('zen-editor[name="comment"]')?.getAttribute('upload-url');
  const uid = doc.querySelector('input[name="uid"]')?.getAttribute('value');
  if (!uid || !/^[a-zA-Z0-9_-]{1,100}$/.test(uid) || uploadPath !== '/zentao/file-ajaxUpload-' + uid + '.html') {
    return { error: 'upload_form_invalid' };
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.style.display = 'none';
  document.body.appendChild(input);
  let posted = false;
  let imageUrl;
  try {
    await args.image.setOn(input);
    const file = input.files?.[0];
    if (!file || input.files.length !== 1 || file.size !== args.image.size || !/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
      return { error: 'image_not_attached', retryable: false };
    }
    const body = new FormData();
    body.append('imgFile', file);
    posted = true;
    const response = await fetch(uploadPath, { method: 'POST', credentials: 'include', body });
    const receipt = await response.json().catch(() => null);
    if (!response.ok || !receipt || receipt.error !== 0 || typeof receipt.url !== 'string') {
      return { error: 'action_outcome_unknown', retryable: false, status: response.status, uid };
    }
    const url = new URL(receipt.url, location.origin);
    if (url.origin !== location.origin || !/^\/zentao\/file-read-\d+\.(png|jpe?g|gif|webp)$/i.test(url.pathname) || url.search || url.hash) {
      return { error: 'action_outcome_unknown', retryable: false, uid };
    }
    imageUrl = url.href;
    const saved = await fetch(imageUrl, { credentials: 'include' });
    if (!saved.ok || !/^image\/(png|jpeg|gif|webp)(?:;|$)/i.test(saved.headers.get('content-type') || '') || !(await saved.arrayBuffer()).byteLength) {
      return { error: 'action_outcome_unknown', retryable: false, image_url: imageUrl, image_uid: uid };
    }
    return {
      bugId: Number(id), uploaded: true, verified: true,
      image_url: imageUrl, image_uid: uid,
      html: '<p><img src="' + url.pathname + '" alt="Bug ' + id + ' 截图" /></p>',
      next: '用 bug-comment 或 bug-resolve 的 --image_url 和 --image_uid 把截图贴入备注，上传本身不会发布备注或修改状态',
    };
  } catch (error) {
    return { error: posted ? 'action_outcome_unknown' : 'upload_not_started', retryable: false, image_url: imageUrl, image_uid: uid, detail: String(error) };
  } finally {
    input.remove();
  }
}
