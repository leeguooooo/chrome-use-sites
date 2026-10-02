/* @meta
{
  "name": "si12333/pension-payments",
  "description": "国家社会保险公共服务平台：企业职工基本养老保险缴费明细（全部参保地、全部年份）",
  "domain": "si.12333.gov.cn",
  "timeout": 600,
  "args": {
    "from": {"required": false, "description": "开始年份，默认 1995"},
    "to": {"required": false, "description": "结束年份，默认今年"},
    "region": {"required": false, "description": "只查名称包含该文字的参保地，默认全部"}
  },
  "readOnly": true
}
*/
async function(args) {
  // The page encrypts both request and response bodies, so the adapter drives
  // the page's own Vue form instead of calling the API. Max span per query is
  // 3 years, and each query asks which 参保地 (one per provincial pool) to show.
  const QUERY_URL = 'https://si.12333.gov.cn/osptb/index.html#/protectCaptureQuery?2KZzg/x4yC1GtuDNv4vsJRwbmqWn7CuZL2iSBqV/vDE=';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => !!el && el.offsetParent !== null;
  const text = (el) => (el && el.innerText || '').replace(/\s+/g, ' ').trim();
  const progress = (m) => { if (typeof args.progress === 'function') args.progress(m); };

  const thisYear = new Date().getFullYear();
  const from = parseInt(args.from || '1995', 10);
  const to = parseInt(args.to || String(thisYear), 10);
  if (!(from > 1900 && to >= from)) return { error: 'bad year range', from: args.from, to: args.to };

  const modals = () => [...document.querySelectorAll('.ant-modal-wrap, .ant-modal')].filter(visible);
  const modalText = () => modals().map(text).join(' | ');
  const loggedOut = () => /登录信息已失效|请先登录/.test(modalText());
  const dismissNotices = async () => {
    for (let i = 0; i < 5; i++) {
      const b = [...document.querySelectorAll('.ant-modal button')].find((x) => visible(x) && text(x) === '知道了');
      if (!b) return;
      b.click();
      await sleep(250);
    }
  };
  const mainButton = () => [...document.querySelectorAll('button')]
    .find((x) => text(x).replace(/\s/g, '') === '查询' && !x.closest('.ant-modal'));

  if (!location.href.includes('protectCaptureQuery')) {
    location.href = QUERY_URL;
    return { status: 'incomplete', note: 'opened the query page' };
  }
  for (let i = 0; i < 40 && !mainButton(); i++) await sleep(250);
  if (loggedOut() || !mainButton()) {
    return { error: 'not logged in', hint: '在 si.12333.gov.cn 用掌上12333扫码或电子社保卡登录后重试' };
  }

  // Count completed payment queries; the page answers each with querySocialPayment.
  if (!window.__si12333Hook) {
    window.__si12333Hook = { done: 0 };
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { this.__siUrl = String(u); return open.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () {
      if (this.__siUrl && this.__siUrl.includes('querySocialPayment')) {
        this.addEventListener('loadend', () => { window.__si12333Hook.done++; });
      }
      return send.apply(this, arguments);
    };
  }

  const form = () => {
    let v = mainButton().__vue__;
    while (v && v.$options.name !== 'Form_WrappedComponent') v = v.$parent;
    return v;
  };
  const f = form();
  if (!f) return { error: 'query form not found; the page layout may have changed' };
  const shown = f.getFieldsValue();
  const proto = shown.aae042 || shown.aae041;
  if (!proto || !proto.clone) return { error: 'month picker value not found; click 重置 once and retry' };

  const readRows = () => {
    const out = [];
    document.querySelectorAll('.vxe-table--body .vxe-body--row, .ant-table-tbody tr').forEach((tr) => {
      const cells = [...tr.querySelectorAll('td')].map(text);
      if (cells.length >= 5 && /^\d{6}$/.test(cells[1])) {
        out.push({ period: cells[1], place: cells[2], employer: cells[3], personal: Number(cells[4]) });
      }
    });
    return out;
  };

  const waitQuery = async (before) => {
    for (let i = 0; i < 80; i++) {
      await sleep(150);
      if (window.__si12333Hook.done > before) { await sleep(600); return true; }
      if (loggedOut()) return false;
    }
    return false;
  };

  const queryWindow = async (y1, y2, region) => {
    await dismissNotices();
    f.setFieldsValue({
      aae041: proto.clone().year(y1).month(0).date(1),
      aae042: proto.clone().year(y2).month(11).date(1),
    });
    await sleep(200);
    const before = window.__si12333Hook.done;
    mainButton().click();
    let picker;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      picker = modals().find((m) => text(m).includes('请选择参保地'));
      if (picker || window.__si12333Hook.done > before || loggedOut()) break;
    }
    if (loggedOut()) throw new Error('logged out');
    if (!picker) {
      // A single pool answers directly without the chooser.
      await waitQuery(before);
      const notice = modalText();
      await dismissNotices();
      return { regions: [], rows: readRows(), notice };
    }
    const wrappers = [...picker.querySelectorAll('.ant-radio-wrapper')];
    const regions = wrappers.map(text);
    if (!region) return { regions };
    const w = wrappers.find((x) => text(x) === region);
    if (!w) throw new Error('region not offered: ' + region);
    (w.querySelector('input') || w).click();
    await sleep(200);
    const ok = [...picker.querySelectorAll('button')].find((x) => text(x).replace(/\s/g, '') === '查询');
    const before2 = window.__si12333Hook.done;
    ok.click();
    if (!(await waitQuery(before2))) {
      if (loggedOut()) throw new Error('logged out');
      throw new Error('query timed out: ' + region + ' ' + y1 + '-' + y2);
    }
    const notice = modalText();
    const rows = /未查询到/.test(notice) ? [] : readRows();
    await dismissNotices();
    return { rows, notice };
  };

  const windows = [];
  for (let y = from; y <= to; y += 3) windows.push([y, Math.min(y + 2, to)]);

  let regions;
  try {
    regions = (await queryWindow(windows[windows.length - 1][0], windows[windows.length - 1][1], null)).regions;
    const cancel = modals().map((m) => [...m.querySelectorAll('button')].find((x) => text(x).replace(/\s/g, '') === '返回')).find(Boolean);
    if (cancel) { cancel.click(); await sleep(300); }
  } catch (e) {
    return { error: String(e.message || e) };
  }
  if (!regions || !regions.length) regions = [null];
  if (args.region) regions = regions.filter((r) => r && r.includes(args.region));

  const rows = [];
  for (const region of regions) {
    for (const [y1, y2] of windows) {
      progress((region || '默认参保地') + ' ' + y1 + '-' + y2);
      try {
        const r = await queryWindow(y1, y2, region);
        for (const row of r.rows || []) {
          if (row.period.slice(0, 4) >= String(y1) && row.period.slice(0, 4) <= String(y2)) rows.push({ pool: region, ...row });
        }
      } catch (e) {
        return { error: String(e.message || e), partial: rows.length, rows };
      }
    }
  }

  const seen = new Set();
  const unique = rows.filter((r) => {
    const k = [r.pool, r.period, r.employer, r.personal].join('|');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a, b) => a.period.localeCompare(b.period));

  const byMonth = {};
  unique.forEach((r) => { (byMonth[r.period] = byMonth[r.period] || []).push(r.pool); });
  const summary = {};
  unique.forEach((r) => {
    const s = summary[r.pool || ''] = summary[r.pool || ''] || { months: 0, first: r.period, last: r.period, personal_total: 0 };
    s.months++;
    s.last = r.period;
    s.personal_total = Math.round((s.personal_total + r.personal) * 100) / 100;
  });

  return {
    from, to,
    pools: regions.filter(Boolean),
    distinct_months: Object.keys(byMonth).length,
    overlapping_months: Object.keys(byMonth).filter((k) => new Set(byMonth[k]).size > 1),
    summary,
    rows: unique.map((r) => ({ ...r, base_est: Math.round(r.personal / 0.08) })),
  };
}
