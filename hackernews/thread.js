/* @meta
{
  "name": "hackernews/thread",
  "description": "获取 Hacker News 帖子的评论树",
  "domain": "news.ycombinator.com",
  "args": {
    "id": {"required": true, "description": "HN item ID or URL"},
    "depth": {"required": false, "description": "Comment tree depth (default: 2, max: 5)"}
  },
  "params": {
    "id": {"type": "string", "required": true, "description": "HN item ID or URL"},
    "depth": {"type": "number", "required": false, "description": "Comment tree depth (default: 2, max: 5)"}
  },
  "auth": "none",
  "profile": "not_applicable",
  "side_effect": "read_only",
  "retry_safety": "safe_with_backoff",
  "max_concurrency": 4,
  "serialization_key": "site:hackernews",
  "output_modes": ["legacy", "envelope_v1"],
  "timeout_class": "standard",
  "envelope_versions": ["pinix.site-result-envelope.v1"],
  "readOnly": true,
  "example": "chrome-use site hackernews/thread 12345678"
}
*/

async function(args) {
  // Runs in a news.ycombinator.com tab. HN's CSP is `default-src 'self'` with
  // no connect-src, so the page cannot fetch hacker-news.firebaseio.com (the
  // community adapter did, and always failed with "Failed to fetch"). Read the
  // same-origin `item?id=` page instead: it lists the comments in tree order,
  // each row carrying its depth in `td.ind[indent]`.
  if (args.id === undefined || args.id === null || args.id === '') return {error: 'Missing argument: id', hint: 'Provide an HN item ID or item URL'};
  let itemId = String(args.id).trim();
  const urlMatch = itemId.match(/id=(\d+)/);
  if (urlMatch) itemId = urlMatch[1];
  if (!/^\d+$/.test(itemId)) return {error: 'Bad id: ' + args.id, hint: 'Provide an HN item ID or item URL'};
  const parsedDepth = parseInt(args.depth);
  const depthLimit = Math.min(Math.max(Number.isFinite(parsedDepth) ? parsedDepth : 2, 0), 5);
  const FANOUT = 30;
  const MAX_PAGES = 5;
  const ORIGIN = 'https://news.ycombinator.com';
  const itemUrl = ORIGIN + '/item?id=' + itemId;
  const stats = {deleted_dead: 0, depth_truncated: 0, child_limit_truncated: 0};

  const decode = (s) => String(s)
    .replace(/<[^>]*>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .trim();
  // HN prints times as `title="2026-10-11T13:16:45"` (UTC) or with the unix
  // time after a space; the API's `time` is unix seconds.
  const unixTime = (chunk) => {
    const m = chunk.match(/<span class=["']age["'] title=["']([^"' ]+)(?: (\d+))?["']/);
    if (!m) return null;
    if (m[2]) return Number(m[2]);
    const ms = Date.parse(/Z|[+-]\d\d:?\d\d$/.test(m[1]) ? m[1] : m[1] + 'Z');
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  };
  // Inner HTML of `div.commtext` / `div.toptext`: HTML like the API's `text`.
  // HN comment bodies never contain a <div>, so the first </div> closes it.
  const innerOf = (chunk, cls) => {
    const m = chunk.match(new RegExp('<(?:div|span) class=["\']' + cls + '(?:\\s[^"\']*)?["\'][^>]*>([\\s\\S]*?)</(?:div|span)>'));
    if (!m) return null;
    const html = m[1].replace(/<div class=["']reply["'][\s\S]*$/, '').trim();
    return html === '' ? null : html;
  };

  async function load(url) {
    const resp = await fetch(url, {credentials: 'include'});
    if (!resp.ok) return {error: 'HTTP ' + resp.status, hint: 'GET ' + url};
    return {html: await resp.text()};
  }

  const first = await load(itemUrl);
  if (first.error) return first;
  const html = first.html;
  if (/^\s*No such item\.?\s*$/i.test(html) || !/class=["']fatitem["']/.test(html)) {
    return {error: 'Item not found', hint: 'Check the ID: ' + itemId};
  }

  // Root item: the `table.fatitem`.
  const fatStart = html.search(/<table class=["']fatitem["']/);
  const treeStart = html.search(/<table[^>]*class=["']comment-tree["']/);
  const fat = html.slice(fatStart, treeStart > fatStart ? treeStart : html.length);
  const title = fat.match(/<span class=["']titleline["']>\s*<a href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/);
  const score = fat.match(/<span class=["']score["'][^>]*>\s*(\d+)\s*point/);
  const author = fat.match(/class=["']hnuser["'][^>]*>([^<]*)</);
  const commentsCount = fat.match(/>\s*(\d+)(?:&nbsp;|\s)+comments?\s*</);
  const href = title ? decode(title[1]) : null;
  const rootDeleted = /\[deleted\]/.test(fat) && !author;
  const rootDead = /\[(?:dead|flagged)\]/.test(fat);
  const rootUnavailable = rootDeleted || rootDead;

  // Comments, in page order, across up to MAX_PAGES pages (very large threads
  // are split with a "More" link).
  const rows = [];
  let pageHtml = html;
  let pagesRead = 0;
  let moreUnread = false;
  for (;;) {
    pagesRead += 1;
    const re = /<tr class=["']athing comtr[^"']*["'] id=["'](\d+)["']/g;
    const starts = [];
    let m;
    while ((m = re.exec(pageHtml))) starts.push({id: Number(m[1]), at: m.index});
    for (let i = 0; i < starts.length; i++) {
      const chunk = pageHtml.slice(starts[i].at, i + 1 < starts.length ? starts[i + 1].at : pageHtml.length);
      const indent = chunk.match(/class=["']ind["'][^>]*indent=["'](\d+)["']/);
      const by = chunk.match(/class=["']hnuser["'][^>]*>([^<]*)</);
      const text = innerOf(chunk, 'commtext');
      const plain = text === null ? '' : decode(text);
      const gone = !by || /^\[(?:deleted|dead|flagged)\]$/.test(plain) || /class=["']commtext cdd["']/.test(chunk);
      rows.push({
        id: starts[i].id,
        depth: indent ? Number(indent[1]) : 0,
        author: by ? decode(by[1]) : null,
        text,
        time: unixTime(chunk),
        gone
      });
    }
    const more = pageHtml.match(/<a href=["']([^"']*)["'][^>]*class=["']morelink["']/);
    if (!more) break;
    if (pagesRead >= MAX_PAGES) {
      moreUnread = true;
      break;
    }
    const next = await load(ORIGIN + '/' + decode(more[1]).replace(/^\//, ''));
    if (next.error) {
      moreUnread = true;
      break;
    }
    pageHtml = next.html;
  }

  // Rebuild the tree from the flat, depth-annotated rows.
  const root = {replies: []};
  const stack = [root];
  for (const row of rows) {
    const node = {...row, replies: []};
    while (stack.length > row.depth + 1) stack.pop();
    (stack[stack.length - 1] || root).replies.push(node);
    stack.push(node);
  }

  // Same bounds as the API version: up to FANOUT children per node, depth
  // 0..depthLimit, deleted/dead comments (and their replies) dropped.
  function bound(nodes, depth) {
    if (!nodes || nodes.length === 0) return [];
    if (depth > depthLimit) {
      stats.depth_truncated += nodes.length;
      return [];
    }
    if (nodes.length > FANOUT) stats.child_limit_truncated += nodes.length - FANOUT;
    return nodes.slice(0, FANOUT).map((c) => {
      if (c.gone) {
        stats.deleted_dead += 1;
        return null;
      }
      return {
        id: c.id, author: c.author, text: c.text, time: c.time, depth,
        replies: bound(c.replies, depth + 1)
      };
    }).filter(Boolean);
  }

  const comments = bound(root.replies, 0);
  function countComments(nodes) {
    return nodes.reduce((total, node) => total + 1 + countComments(node.replies || []), 0);
  }
  const commentsReturned = countComments(comments);
  const id = Number(itemId);
  const data = {
    post: {
      id,
      title: title ? decode(title[2]) : null,
      url: href && !/^item\?id=/.test(href) ? (/^https?:\/\//i.test(href) ? href : ORIGIN + '/' + href) : null,
      hn_url: ORIGIN + '/item?id=' + id,
      author: author ? decode(author[1]) : null,
      score: score ? Number(score[1]) : null,
      comments_count: commentsCount ? Number(commentsCount[1]) : 0,
      time: unixTime(fat),
      text: innerOf(fat, 'toptext') || (title ? null : innerOf(fat, 'commtext'))
    },
    comments
  };
  const partial = rootUnavailable || moreUnread || stats.deleted_dead > 0 || stats.depth_truncated > 0 || stats.child_limit_truncated > 0;
  const reason = rootUnavailable ? 'root_unavailable' : (partial ? 'comments_omitted' : 'complete');

  return {
    __pinix_site_result: {
      version: 'pinix.site-adapter-result.v1',
      metadata: {
        effective_args: {id: String(itemId), depth: depthLimit},
        completeness: partial ? 'partial' : 'complete',
        reason,
        source: {url: itemUrl},
        pagination: {
          depth: depthLimit,
          comments_returned: commentsReturned,
          top_level_comments_returned: comments.length,
          pages_read: pagesRead,
          more_pages_unread: moreUnread,
          root_deleted: rootDeleted ? 1 : 0,
          root_dead: rootDead ? 1 : 0,
          deleted_dead_omitted: stats.deleted_dead,
          depth_truncated: stats.depth_truncated,
          child_limit_truncated: stats.child_limit_truncated
        },
        auth: {authenticated_as: 'not_applicable'},
        warnings: rootUnavailable
          ? [{code: 'ROOT_UNAVAILABLE', message: 'The root HN item is deleted or dead; what the page still shows is returned but completeness is partial.'}]
          : (partial ? [{code: 'PARTIAL_COMMENTS', message: 'Some comments were omitted because they were deleted/dead, beyond adapter depth/fanout limits, or on comment pages past the first ' + MAX_PAGES + '.'}] : undefined)
      }
    },
    data
  };
}
