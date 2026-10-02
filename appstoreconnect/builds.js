/* @meta
{
  "name": "appstoreconnect/builds",
  "description": "Recent builds of one app (newest first) with their processing state, so you can see when an upload is ready for TestFlight. Runs as you, in your logged-in appstoreconnect.apple.com tab.",
  "domain": "appstoreconnect.apple.com",
  "args": {
    "bundle_id": {"required": true, "description": "The app's bundle id"},
    "limit": {"required": false, "description": "How many builds (default 10, max 50)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "chrome-use site appstoreconnect/builds --bundle_id com.example.app"
}
*/
async function (args) {
  if (!args.bundle_id) return { error: 'Missing argument: bundle_id' };
  const headers = { Accept: 'application/json', 'X-Csrf-Itc': 'itc' };
  const iris = location.origin + '/iris/v1';
  const a = await fetch(iris + '/apps?' + new URLSearchParams({ 'filter[bundleId]': args.bundle_id, 'fields[apps]': 'bundleId' }),
    { credentials: 'include', headers });
  if (a.status === 401 || a.status === 403)
    return { error: 'HTTP ' + a.status, hint: 'Not signed in to App Store Connect in this browser (sign in, finish 2FA, then retry)' };
  if (!a.ok) return { error: 'HTTP ' + a.status };
  const app = ((await a.json()).data || []).find((x) => x.attributes.bundleId === args.bundle_id);
  if (!app) return { error: 'No app with bundle id ' + args.bundle_id, hint: 'Create it with appstoreconnect/app-create' };

  const limit = Math.min(50, Math.max(1, Number(args.limit) || 10));
  const r = await fetch(iris + '/builds?' + new URLSearchParams({
    'filter[app]': app.id, sort: '-uploadedDate', limit: String(limit),
    'fields[builds]': 'version,uploadedDate,processingState,expired,minOsVersion'
  }), { credentials: 'include', headers });
  if (!r.ok) return { error: 'HTTP ' + r.status, detail: (await r.text()).slice(0, 300) };
  const builds = ((await r.json()).data || []).map((b) => ({
    id: b.id,
    build: b.attributes.version,
    state: b.attributes.processingState,
    uploaded: b.attributes.uploadedDate,
    expired: b.attributes.expired,
    min_os: b.attributes.minOsVersion
  }));
  return { app_id: app.id, count: builds.length, builds };
}
