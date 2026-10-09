/* @meta
{
  "name": "twitter/user",
  "description": "X profile counts (followers, following, posts, media, likes) and bio; without a handle, the signed-in account",
  "domain": "x.com",
  "args": {
    "screen_name": {"required": false, "description": "Handle without @ (default: the signed-in account)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "chrome-use site twitter/user leeguooooo"
}
*/

async function(args) {
  args = args || {};
  const ct0 = document.cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith('ct0='))?.split('=')[1];
  if (!ct0) return {error: 'No ct0 cookie', hint: 'Not logged into x.com. Open x.com and log in first.'};
  const bearer = decodeURIComponent('AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA');
  const _h = {'Authorization':'Bearer '+bearer, 'X-Csrf-Token':ct0, 'X-Twitter-Auth-Type':'OAuth2Session', 'X-Twitter-Active-User':'yes'};

  let screenName = String(args.screen_name || '').trim().replace(/^@/, '');
  const urlMatch = screenName.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]+)/);
  if (urlMatch) screenName = urlMatch[1];
  if (!screenName) {
    // The side nav's Profile link carries the signed-in handle.
    const link = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
    const m = link && (link.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]+)/);
    if (!m) return {error: 'Cannot tell which account is signed in', hint: 'Pass a handle: chrome-use site twitter/user <screen_name>'};
    screenName = m[1];
  }

  const variables = JSON.stringify({screen_name: screenName, withSafetyModeUserFields: true});
  const features = JSON.stringify({
    hidden_profile_subscriptions_enabled: true, responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false, responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true, profile_label_improvements_pcf_label_in_post_enabled: true,
    rweb_tipjar_consumption_enabled: true, subscriptions_feature_can_gift_premium: true,
    highlights_tweets_tab_ui_enabled: true, responsive_web_twitter_article_notes_tab_enabled: true,
    subscriptions_verification_info_is_identity_verified_enabled: true,
    subscriptions_verification_info_verified_since_enabled: true, creator_subscriptions_tweet_preview_api_enabled: true
  });
  const queryId = findGraphQLQueryId('UserByScreenName', 'pLsOiyHJ1eFwPJlNmLp4Bg');
  if (!queryId) return {error: 'Cannot find UserByScreenName queryId', hint: 'x.com API structure may have changed'};
  const url = '/i/api/graphql/' + queryId + '/UserByScreenName?variables=' + encodeURIComponent(variables) + '&features=' + encodeURIComponent(features);
  const resp = await fetch(url, {headers: _h, credentials: 'include'});
  if (!resp.ok) return {error: 'HTTP ' + resp.status, hint: 'queryId may have changed. Check network tab.'};
  const d = await resp.json();
  const u = d.data?.user?.result;
  if (!u || u.__typename === 'UserUnavailable') return {error: 'User not found', hint: 'Check spelling: @' + screenName};

  // X keeps moving profile fields out of `legacy`: name/screen_name/created_at
  // went to `core`, bio and location to their own objects, and with the 2026
  // query the counts to relationship_counts / tweet_counts / action_counts.
  // Read the new place first and fall back to legacy for older query ids.
  const l = u.legacy || {};
  const c = u.core || {};
  const rel = u.relationship_counts || {};
  const tc = u.tweet_counts || {};
  const ac = u.action_counts || {};
  const num = (...vs) => {
    for (const v of vs) if (v != null && v !== '' && Number.isFinite(Number(v))) return Number(v);
    return null;
  };
  const handle = c.screen_name || l.screen_name || screenName;
  return {
    id: u.rest_id || null,
    name: c.name || l.name || null,
    screen_name: handle,
    url: 'https://x.com/' + handle,
    bio: u.profile_bio?.description ?? l.description ?? null,
    location: u.location?.location ?? l.location ?? null,
    website: l.entities?.url?.urls?.[0]?.expanded_url || u.website?.url || l.url || null,
    created_at: c.created_at || l.created_at || null,
    followers: num(rel.followers, l.followers_count),
    following: num(rel.following, l.friends_count),
    tweets: num(tc.tweets, l.statuses_count),
    media: num(tc.media_tweets, l.media_count),
    likes: num(ac.favorites_count, l.favourites_count),
    pinned_tweet_ids: u.pinned_items?.tweet_ids_str || l.pinned_tweet_ids_str || [],
    verified: Boolean(u.is_blue_verified),
  };
}
