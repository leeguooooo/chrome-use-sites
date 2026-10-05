/* @meta
{
  "name": "twitter/post",
  "description": "Post a tweet (or a reply) from the logged-in x.com account through X's own CreateTweet call",
  "domain": "x.com",
  "args": {
    "text": {"required": true, "description": "Tweet text (pass a file with --text @tweet.txt). Checked against X's 280-character weighting before anything is sent: CJK characters count 2, every link counts 23"},
    "reply_to": {"required": false, "description": "Tweet ID or URL to reply to"},
    "media": {"required": false, "type": "file", "input": "#cu-twitter-post-media", "description": "Local video (mp4/mov) or image to attach. Uploaded the way the web app does (chunked INIT/APPEND/FINALIZE, then waiting for X to process a video) before the tweet is posted. Use with --timeout 5m for a large video"},
    "dry_run": {"required": false, "description": "true = check the text and return what would be sent, without posting (default false)"}
  },
  "capabilities": ["network"],
  "readOnly": false,
  "example": "chrome-use site twitter/post --text @tweet.txt --media ./clip.mp4 --timeout 5m"
}
*/

async function(args) {
  const text = String(args.text == null ? '' : args.text).replace(/\r\n/g, '\n').trim();
  if (!text) return {error: 'Missing argument: text', hint: 'Pass the tweet text, e.g. --text @tweet.txt'};

  // X's weighted length (twitter-text v3): code points in these ranges count
  // 1, everything else (CJK, emoji, …) 2; each URL counts 23 whatever its length.
  const LIGHT = [[0x0000, 0x10FF], [0x2000, 0x200D], [0x2010, 0x201F], [0x2032, 0x2037]];
  const urlRe = /https?:\/\/[^\s]+/g;
  const urls = text.match(urlRe) || [];
  let weighted = urls.length * 23;
  for (const ch of text.replace(urlRe, '')) {
    const cp = ch.codePointAt(0);
    weighted += LIGHT.some(([lo, hi]) => cp >= lo && cp <= hi) ? 1 : 2;
  }
  if (weighted > 280) {
    return {
      error: 'Tweet is too long: ' + weighted + ' of 280 (CJK characters count 2, links 23)',
      hint: 'Shorten it, or split it and post the rest with --reply_to the first tweet.',
      weighted_length: weighted,
    };
  }

  let replyTo = args.reply_to ? String(args.reply_to) : '';
  const m = replyTo.match(/\/status\/(\d+)/);
  if (m) replyTo = m[1];
  if (replyTo && !/^\d+$/.test(replyTo)) return {error: 'reply_to must be a tweet ID or a status URL'};

  const variables = {
    tweet_text: text,
    dark_request: false,
    media: {media_entities: [], possibly_sensitive: false},
    semantic_annotation_ids: [],
    disallowed_reply_options: null,
  };
  if (replyTo) variables.reply = {in_reply_to_tweet_id: replyTo, exclude_reply_user_ids: []};

  const localFile = args.media && typeof args.media === 'object' && typeof args.media.setOn === 'function' ? args.media : null;
  if (args.media && !localFile) return {error: 'media must be a local file path', hint: 'Pass --media ./clip.mp4 (needs chrome-use 1.5.149+)'};

  const dry = String(args.dry_run) === 'true';
  if (dry) return {ok: true, dry_run: true, weighted_length: weighted, variables, media: localFile ? {name: localFile.name, size: localFile.size} : null};

  const ct0 = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('ct0='))?.split('=')[1];
  if (!ct0) return {error: 'Not signed in to x.com', hint: 'Log in at https://x.com in this browser, then retry.'};
  const genTxId = await findTransactionIdGenerator();
  if (!genTxId) return {error: 'Cannot find transaction-id generator', hint: 'x.com webpack structure may have changed'};
  const queryId = findGraphQLQueryId('CreateTweet', 'IID9x6WsdMnTlXnzXGq8ng');
  if (!queryId) return {error: 'Cannot find CreateTweet queryId', hint: 'x.com API structure may have changed'};

  const features = {
    premium_content_api_read_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    responsive_web_grok_analyze_button_fetch_trends_enabled: false,
    responsive_web_grok_analyze_post_followups_enabled: true,
    responsive_web_jetfuel_frame: false,
    responsive_web_grok_share_attachment_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    responsive_web_grok_show_grok_translated_post: false,
    responsive_web_grok_analysis_button_from_backend: true,
    creator_subscriptions_quote_tweet_preview_enabled: false,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    profile_label_improvements_pcf_label_in_post_enabled: true,
    rweb_tipjar_consumption_enabled: true,
    verified_phone_label_enabled: false,
    articles_preview_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    responsive_web_grok_image_annotation_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_enhance_cards_enabled: false,
  };

  const bearer = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  const auth = {
    'Authorization': 'Bearer ' + decodeURIComponent(bearer),
    'X-Csrf-Token': ct0,
    'X-Twitter-Auth-Type': 'OAuth2Session',
    'X-Twitter-Active-User': 'yes',
  };

  if (localFile) {
    // chrome-use puts the local file on a file input in this page; read it back
    // from there and upload it the way the web composer does.
    let input = document.getElementById('cu-twitter-post-media');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.id = 'cu-twitter-post-media';
      input.style.display = 'none';
      document.body.appendChild(input);
    }
    try {
      await localFile.setOn('#cu-twitter-post-media');
    } catch (e) {
      return {error: 'Could not attach ' + localFile.name + ': ' + ((e && e.message) || e)};
    }
    const file = input.files && input.files[0];
    if (!file) return {error: 'The file did not reach the page', hint: 'Retry; nothing was posted.'};
    const isVideo = /^video\//.test(file.type) || /\.(mp4|mov|m4v)$/i.test(file.name);
    const mediaType = file.type || (isVideo ? 'video/mp4' : 'image/jpeg');
    const category = isVideo ? 'tweet_video' : (/gif$/i.test(mediaType) ? 'tweet_gif' : 'tweet_image');
    const UPLOAD = 'https://upload.x.com/i/media/upload.json';
    const call = async (query, init) => {
      const r = await fetch(UPLOAD + '?' + new URLSearchParams(query), Object.assign({credentials: 'include', headers: auth}, init || {}));
      let j = null;
      try { j = await r.json(); } catch (e) { j = null; }
      return {ok: r.ok, status: r.status, json: j};
    };
    const fail = (step, r) => ({
      error: 'Media upload failed at ' + step + ': HTTP ' + r.status + ((r.json && r.json.error) ? ' ' + r.json.error : ''),
      hint: 'Nothing was posted.',
    });
    const init = await call({command: 'INIT', total_bytes: String(file.size), media_type: mediaType, media_category: category}, {method: 'POST'});
    const mediaId = init.json && init.json.media_id_string;
    if (!init.ok || !mediaId) return fail('INIT', init);
    const CHUNK = 4 * 1024 * 1024;
    for (let i = 0, off = 0; off < file.size; i++, off += CHUNK) {
      const form = new FormData();
      form.append('media', file.slice(off, off + CHUNK));
      const app = await call({command: 'APPEND', media_id: mediaId, segment_index: String(i)}, {method: 'POST', body: form});
      if (!app.ok) return fail('APPEND ' + i, app);
    }
    const fin = await call({command: 'FINALIZE', media_id: mediaId}, {method: 'POST'});
    if (!fin.ok) return fail('FINALIZE', fin);
    let info = fin.json && fin.json.processing_info;
    const deadline = Date.now() + 240000;
    while (info && info.state !== 'succeeded') {
      if (info.state === 'failed') {
        return {error: 'X could not process the media: ' + ((info.error && info.error.message) || 'failed'), hint: 'Nothing was posted.'};
      }
      if (Date.now() > deadline) return {error: 'X is still processing the media', hint: 'Nothing was posted; run again later.', media_id: mediaId};
      await new Promise(res => setTimeout(res, Math.max(1, info.check_after_secs || 2) * 1000));
      const st = await call({command: 'STATUS', media_id: mediaId}, {method: 'GET'});
      if (!st.ok) return fail('STATUS', st);
      info = st.json && st.json.processing_info;
    }
    variables.media.media_entities = [{media_id: mediaId, tagged_users: []}];
  }

  const path = '/i/api/graphql/' + queryId + '/CreateTweet';
  const txId = await genTxId('x.com', path, 'POST');
  const resp = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: Object.assign({}, auth, {'Content-Type': 'application/json', 'X-Client-Transaction-Id': txId}),
    body: JSON.stringify({variables, features, queryId}),
  });
  let body = null;
  try { body = await resp.json(); } catch (e) { body = null; }
  const apiError = body && body.errors && body.errors[0];
  if (!resp.ok || apiError) {
    return {
      error: 'X refused the tweet: ' + (apiError ? apiError.message : 'HTTP ' + resp.status),
      hint: 'Nothing was posted. A duplicate of a recent tweet, an automation check or a stale queryId can cause this; post it by hand if it persists.',
      status: resp.status,
    };
  }
  const result = body && body.data && body.data.create_tweet && body.data.create_tweet.tweet_results && body.data.create_tweet.tweet_results.result;
  const id = result && (result.rest_id || (result.tweet && result.tweet.rest_id));
  if (!id) return {error: 'X answered without a tweet id', hint: 'Check your profile before posting again: it may or may not have gone out.', outcome: 'unknown'};
  const user = result.core && result.core.user_results && result.core.user_results.result;
  const screen = (user && ((user.legacy && user.legacy.screen_name) || (user.core && user.core.screen_name))) || 'i';
  const media = variables.media.media_entities.map(m => m.media_id);
  return {ok: true, id, url: 'https://x.com/' + screen + '/status/' + id, weighted_length: weighted, in_reply_to: replyTo || null, media};
}
