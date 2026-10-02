/* @meta
{
  "name": "appstoreconnect/apps",
  "description": "List the apps in your App Store Connect account (name, bundle id, SKU, Apple ID). Runs as you, in your logged-in appstoreconnect.apple.com tab, through the same /iris/v1 API the web UI uses.",
  "domain": "appstoreconnect.apple.com",
  "args": {
    "bundle_id": {"required": false, "description": "Only the app with this bundle id, e.g. com.example.app"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "chrome-use site appstoreconnect/apps  |  chrome-use site appstoreconnect/apps --bundle_id com.example.app"
}
*/
async function (args) {
  const q = new URLSearchParams({ limit: '200', 'fields[apps]': 'name,bundleId,sku,primaryLocale' });
  if (args.bundle_id) q.set('filter[bundleId]', args.bundle_id);
  const r = await fetch(location.origin + '/iris/v1/apps?' + q, {
    credentials: 'include',
    headers: { Accept: 'application/json', 'X-Csrf-Itc': 'itc' }
  });
  if (r.status === 401 || r.status === 403)
    return { error: 'HTTP ' + r.status, hint: 'Not signed in to App Store Connect in this browser (sign in, finish 2FA, then retry)' };
  if (!r.ok) return { error: 'HTTP ' + r.status, detail: (await r.text()).slice(0, 300) };
  const body = await r.json();
  const apps = (body.data || []).map((a) => ({
    id: a.id,
    name: a.attributes.name,
    bundle_id: a.attributes.bundleId,
    sku: a.attributes.sku,
    primary_locale: a.attributes.primaryLocale,
    url: location.origin + '/apps/' + a.id
  }));
  return { count: apps.length, apps };
}
