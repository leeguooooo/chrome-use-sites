/* @meta
{
  "name": "appstoreconnect/app-create",
  "description": "Create an app record in App Store Connect (the \"New App\" dialog) for a bundle id already registered in the developer portal. The ASC API key cannot do this; your signed-in session can. Idempotent: if an app with the bundle id exists it is returned, not duplicated.",
  "domain": "appstoreconnect.apple.com",
  "args": {
    "name": {"required": true, "description": "App name as shown on the App Store (at most 30 characters, unique across the store)"},
    "bundle_id": {"required": true, "description": "Registered bundle id, e.g. com.example.app"},
    "sku": {"required": true, "description": "Your own unique id for the app, e.g. example-app"},
    "locale": {"required": false, "description": "Primary language (default en-US), e.g. zh-Hans, ja, en-GB"},
    "platform": {"required": false, "description": "IOS (default) | MAC_OS | TV_OS | VISION_OS"},
    "version": {"required": false, "description": "First version string (default 1.0)"}
  },
  "capabilities": ["network"],
  "readOnly": false,
  "example": "chrome-use site appstoreconnect/app-create --name \"My App\" --bundle_id com.example.app --sku example-app --locale zh-Hans"
}
*/
async function (args) {
  for (const k of ['name', 'bundle_id', 'sku'])
    if (!args[k]) return { error: 'Missing argument: ' + k };
  if (String(args.name).length > 30) return { error: 'name is longer than 30 characters' };
  const platform = String(args.platform || 'IOS').toUpperCase();
  const locale = args.locale || 'en-US';
  const version = String(args.version || '1.0');
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Csrf-Itc': 'itc'
  };
  const iris = location.origin + '/iris/v1';
  const signedOut = { hint: 'Not signed in to App Store Connect in this browser (sign in, finish 2FA, then retry)' };

  const existing = await fetch(iris + '/apps?' + new URLSearchParams({
    'filter[bundleId]': args.bundle_id, 'fields[apps]': 'name,bundleId,sku'
  }), { credentials: 'include', headers });
  if (existing.status === 401 || existing.status === 403) return { error: 'HTTP ' + existing.status, ...signedOut };
  if (existing.ok) {
    const found = ((await existing.json()).data || []).find((a) => a.attributes.bundleId === args.bundle_id);
    if (found)
      return {
        ok: true, created: false, id: found.id, name: found.attributes.name,
        bundle_id: found.attributes.bundleId, sku: found.attributes.sku,
        url: location.origin + '/apps/' + found.id
      };
  }

  // One compound document, as the web UI sends it: the app, its first
  // version with a primary-language version localization, and the app info
  // carrying the name, all linked by local ids. Two things Apple enforces:
  //  - the name only goes on appInfoLocalizations; on the app itself it is
  //    rejected (409);
  //  - the local ids follow the web UI's own scheme (store-version-<platform>,
  //    new-<platform>VersionLocalization-id, ...). Shorter ids such as
  //    ${new-version} / ${new-versionLoc} were rejected on a fresh bundle id
  //    with "You must provide a value for the relationship
  //    'appStoreVersionLocalizations'", while this scheme created the app.
  const p = platform.toLowerCase();
  const id = (name) => '${' + name + '}';
  const versionId = id('store-version-' + p);
  const versionLocId = id('new-' + p + 'VersionLocalization-id');
  const appInfoId = id('new-appInfo-id');
  const appInfoLocId = id('new-appInfoLocalization-id');
  const payload = {
    data: {
      type: 'apps',
      attributes: { sku: args.sku, primaryLocale: locale, bundleId: args.bundle_id },
      relationships: {
        appStoreVersions: { data: [{ type: 'appStoreVersions', id: versionId }] },
        appInfos: { data: [{ type: 'appInfos', id: appInfoId }] }
      }
    },
    included: [
      {
        type: 'appStoreVersions', id: versionId, attributes: { platform, versionString: version },
        relationships: { appStoreVersionLocalizations: { data: [{ type: 'appStoreVersionLocalizations', id: versionLocId }] } }
      },
      { type: 'appStoreVersionLocalizations', id: versionLocId, attributes: { locale } },
      {
        type: 'appInfos', id: appInfoId,
        relationships: { appInfoLocalizations: { data: [{ type: 'appInfoLocalizations', id: appInfoLocId }] } }
      },
      { type: 'appInfoLocalizations', id: appInfoLocId, attributes: { locale, name: args.name } }
    ]
  };
  const r = await fetch(iris + '/apps', {
    method: 'POST', credentials: 'include', headers, body: JSON.stringify(payload)
  });
  if (r.status === 401 || r.status === 403) {
    const text = await r.text();
    if (r.status === 401 || /NOT_AUTHORIZED|not signed/i.test(text)) return { error: 'HTTP ' + r.status, ...signedOut };
    return { error: 'HTTP ' + r.status, hint: 'This Apple ID may lack the Admin or App Manager role', detail: text.slice(0, 300) };
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const errs = (body.errors || []).map((e) => e.detail || e.title).filter(Boolean);
    return { error: 'App not created (HTTP ' + r.status + ')' + (errs.length ? ': ' + errs.join('; ') : ''), reasons: errs, hint: /bundle/i.test(errs.join(' ')) ? 'Register the bundle id in the developer portal first' : undefined };
  }
  const app = body.data;
  return {
    ok: true, created: true, id: app.id, name: app.attributes.name,
    bundle_id: app.attributes.bundleId, sku: app.attributes.sku,
    url: location.origin + '/apps/' + app.id
  };
}
