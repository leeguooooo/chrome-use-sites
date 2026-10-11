/* @meta
{
  "name": "hackernews/top",
  "description": "获取 Hacker News 当前热门帖子",
  "domain": "news.ycombinator.com",
  "args": {
    "count": {"required": false, "description": "Number of posts (default: 20, max: 50)"}
  },
  "params": {
    "count": {"type": "number", "required": false, "description": "Number of posts (default: 20, max: 50)"}
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
  "example": "chrome-use site hackernews/top 10"
}
*/

async function(args) {
  // Runs in a news.ycombinator.com tab. HN's CSP is `default-src 'self'` with
  // no connect-src, so the page cannot fetch hacker-news.firebaseio.com (the
  // community adapter did, and always failed with "Failed to fetch"). Read the
  // same-origin front page HTML instead: 30 stories a page, `?p=2` for more.
  const parsedCount = parseInt(args.count);
  const count = Math.min(Math.max(Number.isFinite(parsedCount) ? parsedCount : 20, 1), 50);
  const ORIGIN = 'https://news.ycombinator.com';
  const sourceUrl = ORIGIN + '/news';

  const decode = (s) => String(s)
    .replace(/<[^>]*>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .trim();
  const absolute = (href) => {
    const h = decode(href);
    if (/^https?:\/\//i.test(h)) return h;
    return ORIGIN + '/' + h.replace(/^\//, '');
  };

  // One story is a `tr.athing` row (rank, title link) followed by a subtext row
  // (score, author, comments). Job ads have no score or author.
  function parsePage(html) {
    const rows = [];
    const re = /<tr[^>]*class=["'][^"']*\bathing\b[^"']*["'][^>]*\bid=["'](\d+)["'][^>]*>/g;
    const starts = [];
    let m;
    while ((m = re.exec(html))) starts.push({ id: Number(m[1]), at: m.index });
    for (let i = 0; i < starts.length; i++) {
      const end = i + 1 < starts.length ? starts[i + 1].at : html.length;
      const chunk = html.slice(starts[i].at, end);
      const rank = chunk.match(/<span class=["']rank["']>\s*(\d+)\./);
      const title = chunk.match(/<span class=["']titleline["']>\s*<a href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/);
      const subAt = chunk.search(/class=["']subtext["']/);
      const sub = subAt >= 0 ? chunk.slice(subAt) : '';
      const score = sub.match(/<span class=["']score["'][^>]*>\s*(\d+)\s*point/);
      const author = sub.match(/class=["']hnuser["'][^>]*>([^<]*)</) || sub.match(/<a href=["']user\?id=([^"'&]+)/);
      const comments = sub.match(/>\s*(\d+)(?:&nbsp;|\s)+comments?\s*</);
      rows.push({
        id: starts[i].id,
        rank: rank ? Number(rank[1]) : null,
        href: title ? title[1] : null,
        title: title ? decode(title[2]) : null,
        score: score ? Number(score[1]) : null,
        author: author ? decode(author[1]) : null,
        comments: comments ? Number(comments[1]) : 0
      });
    }
    return { rows, more: /class=["']morelink["']/.test(html) };
  }

  const pages = Math.ceil(count / 30);
  const seen = [];
  let more = false;
  for (let p = 1; p <= pages; p++) {
    const url = p === 1 ? sourceUrl : sourceUrl + '?p=' + p;
    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) {
      if (p === 1) return { error: 'HTTP ' + resp.status, hint: 'GET ' + url };
      more = true;
      break;
    }
    const page = parsePage(await resp.text());
    seen.push(...page.rows);
    more = page.more;
    if (!page.more) break;
  }

  const selected = seen.slice(0, count);
  const stats = { fetch_missing: 0, deleted_dead: 0, non_story: 0, missing_title: 0 };
  const posts = selected.map((row, i) => {
    if (!row.title) {
      stats.missing_title += 1;
      return null;
    }
    if (row.score === null && row.author === null) {
      // Job ads (YC company hiring posts) are `job` items, not stories.
      stats.non_story += 1;
      return null;
    }
    // Self posts (Ask HN etc.) link to `item?id=`; the API gives them no url.
    const url = row.href && !/^item\?id=/.test(decode(row.href)) ? absolute(row.href) : null;
    return {
      rank: row.rank || i + 1,
      id: row.id,
      title: row.title,
      url,
      hn_url: ORIGIN + '/item?id=' + row.id,
      author: row.author,
      score: row.score || 0,
      comments: row.comments || 0
    };
  }).filter(Boolean);

  const data = {
    count: posts.length,
    posts
  };
  const truncated = seen.length > count || (seen.length >= count && more);
  const selectedOmitted = stats.fetch_missing + stats.deleted_dead + stats.non_story + stats.missing_title;
  const completeness = seen.length === 0 ? 'empty' : ((truncated || selectedOmitted > 0) ? 'partial' : 'complete');
  const reason = seen.length === 0 ? 'no_items' : (
    truncated && selectedOmitted > 0 ? 'limit_truncated_and_selected_items_omitted' :
    selectedOmitted > 0 ? 'selected_items_omitted' :
    truncated ? 'limit_truncated' : 'complete'
  );

  return {
    __pinix_site_result: {
      version: 'pinix.site-adapter-result.v1',
      metadata: {
        effective_args: {count},
        completeness,
        reason,
        source: {url: sourceUrl},
        pagination: {
          limit: count,
          selected: selected.length,
          returned: posts.length,
          total_available: seen.length,
          more_available: more,
          truncated,
          selected_omitted: selectedOmitted,
          fetch_missing_omitted: stats.fetch_missing,
          deleted_dead_omitted: stats.deleted_dead,
          non_story_omitted: stats.non_story,
          missing_title_omitted: stats.missing_title
        },
        auth: {authenticated_as: 'not_applicable'},
        warnings: selectedOmitted > 0 ? [{code: 'SELECTED_ITEMS_OMITTED', message: 'Some front-page rows were job ads or lacked a title.'}] : undefined
      }
    },
    data
  };
}
