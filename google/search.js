/* @meta
{
  "name": "google/search",
  "description": "Google 搜索 (Google search: title, url, domain, snippet)",
  "domain": "www.google.com",
  "args": {
    "query": {"required": true, "description": "Search query"},
    "count": {"required": false, "description": "Number of results (default 10, max 50)"}
  },
  "auth": "none",
  "side_effect": "read_only",
  "readOnly": true,
  "example": "chrome-use site google/search \"chrome-use\" --count 15"
}
*/

async function(args) {
  // Runs in a www.google.com tab and reads Google's own same-origin result
  // pages (`/search?q=…&start=…`, ten results a page). The community version
  // (epiral/bb-sites) returned `count: 0` with no error whenever its parse
  // missed, and passed through Google's relative `/goto?url=…` redirect links.
  // Here a page that parses to nothing is an error unless Google itself says
  // there are no results, and every result carries an absolute `url` plus the
  // `display_url` / `domain` Google prints under the title.
  if (!args.query) return {error: 'Missing argument: query', hint: 'Provide a search query string'};
  const parsed = parseInt(args.count);
  const count = Math.min(Math.max(Number.isFinite(parsed) ? parsed : 10, 1), 50);
  const ORIGIN = 'https://www.google.com';
  const NO_RESULTS = /did not match any documents|找不到和您查询的|找不到符合|に一致する情報は見つかりませんでした|일치하는 검색결과가 없습니다/;

  const text = (el) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '');

  // A result link is a direct URL, Google's `/url?q=` wrapper, or its newer
  // `/goto?url=<token>` redirect. The token is opaque (not the destination),
  // and following it from the page is a cross-origin redirect the page cannot
  // read, so it is returned as an absolute google.com URL that a browser
  // opens normally, with `redirect: true`.
  function resolve(href) {
    if (!href || href.startsWith('#')) return null;
    let u;
    try { u = new URL(href, ORIGIN); } catch (e) { return null; }
    if (u.origin === ORIGIN && u.pathname === '/url') {
      const target = u.searchParams.get('q') || u.searchParams.get('url');
      if (target && /^https?:\/\//i.test(target)) return {url: target, redirect: false};
      return null;
    }
    if (u.origin === ORIGIN && u.pathname === '/goto') return {url: u.href, redirect: true};
    if (/(^|\.)google\.[a-z.]+$/i.test(u.hostname) && /^\/(search|imgres|maps|preferences|advanced_search|setprefs)\b/.test(u.pathname)) return null;
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return {url: u.href, redirect: false};
  }

  // Google prints the destination under the title as `https://host › path`.
  function domainOf(link, display) {
    if (!link.redirect) {
      try { return new URL(link.url).hostname; } catch (e) {}
    }
    const first = (display || '').split(/\s+›\s+|\s›\s/)[0].trim();
    const m = /^(?:https?:\/\/)?([^\/\s›]+\.[^\/\s›]+)/i.exec(first);
    return m ? m[1].toLowerCase() : null;
  }

  function resultBlock(h3) {
    let el = h3;
    for (let i = 0; i < 8 && el.parentElement; i++) {
      el = el.parentElement;
      if (el.matches('[data-hveid], [data-ved].g, .g, .MjjYud') && text(el).length > text(h3).length + 20) return el;
    }
    return h3.parentElement && h3.parentElement.parentElement || h3;
  }

  function snippetOf(block, title, display) {
    const marked = block.querySelector('[data-sncf], .VwiC3b, [style*="-webkit-line-clamp"]');
    if (marked && text(marked)) return text(marked).slice(0, 300);
    let best = '';
    for (const el of block.querySelectorAll('div, span')) {
      if (el.querySelector('h3, cite')) continue;
      const t = text(el);
      if (t.length > best.length && t !== title && t !== display) best = t;
    }
    return best.length > 30 ? best.slice(0, 300) : '';
  }

  function parse(doc) {
    const out = [];
    for (const h3 of doc.querySelectorAll('h3')) {
      const anchor = h3.closest('a[href]');
      if (!anchor) continue;
      const link = resolve(anchor.getAttribute('href'));
      if (!link) continue;
      const title = text(h3);
      if (!title) continue;
      const block = resultBlock(h3);
      const display = text(block.querySelector('cite'));
      out.push({
        title,
        url: link.url,
        domain: domainOf(link, display),
        display_url: display || null,
        redirect: link.redirect,
        snippet: snippetOf(block, title, display),
      });
    }
    return out;
  }

  const pageCount = Math.ceil(count / 10);
  const results = [];
  const seen = new Set();
  let pagesRead = 0;
  let sawNoResults = false;
  for (let page = 0; page < pageCount; page++) {
    if (page > 0) await new Promise((r) => setTimeout(r, 400 + Math.random() * 600));
    const path = '/search?q=' + encodeURIComponent(args.query) + (page ? '&start=' + page * 10 : '');
    let resp;
    try {
      resp = await fetch(path, {credentials: 'include'});
    } catch (e) {
      if (!results.length) return {error: 'Google search request failed: ' + e.message, hint: 'Run it from a www.google.com tab'};
      break;
    }
    if (/\/sorry\//.test(resp.url || '') || resp.status === 429) {
      return {error: 'Google is asking for a CAPTCHA (unusual traffic)', hint: 'Open ' + ORIGIN + path + ' in the tab, solve it there, then retry'};
    }
    if (!resp.ok) {
      if (!results.length) return {error: 'HTTP ' + resp.status, hint: 'Make sure a www.google.com tab is open'};
      break;
    }
    const html = await resp.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    pagesRead++;
    const found = parse(doc);
    if (!found.length) {
      if (NO_RESULTS.test(text(doc.body))) sawNoResults = true;
      break;
    }
    let added = 0;
    for (const r of found) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      results.push(r);
      added++;
    }
    if (!added) break;
  }

  // The fetched page can differ from what the tab renders (Google serves
  // scripted fetches a lighter page at times). If the tab is already on this
  // query's results, read the rendered page before giving up.
  if (!results.length && !sawNoResults && location.pathname === '/search'
      && new URLSearchParams(location.search).get('q') === args.query) {
    for (const r of parse(document)) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      results.push(r);
    }
  }

  if (!results.length) {
    if (sawNoResults) return {query: args.query, count: 0, results: [], no_results: true};
    const first = ORIGIN + '/search?q=' + encodeURIComponent(args.query);
    // A profile that has never loaded a Google results page has no Google
    // cookies yet, and Google answers the background request with its
    // script check instead of results. Loading the results page in the tab
    // once sets them. The tab moves after this result is returned, so the
    // run itself is not cut off; the next run reads the page or fetches again.
    if (location.pathname !== '/search' && typeof location.assign === 'function') {
      setTimeout(() => location.assign(first), 400 + Math.random() * 400);
      return {
        error: 'Google answered with its script check instead of results (usually a profile that has not used Google search yet)',
        hint: 'The tab is now loading ' + first + '. Run the same command again',
        retry: true,
      };
    }
    return {
      error: 'No results could be read from the Google results page',
      hint: 'Google may have changed its markup or served a page without results. Open '
        + ORIGIN + '/search?q=' + encodeURIComponent(args.query) + ' in the tab and read it, then retry this command',
    };
  }
  const sliced = results.slice(0, count);
  return {query: args.query, count: sliced.length, pages_read: pagesRead, results: sliced};
}
