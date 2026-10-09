# `appstoreconnect/` — App Store Connect apps and builds

English · [中文](README.zh.md)

Runs in your signed-in [appstoreconnect.apple.com](https://appstoreconnect.apple.com) tab and calls the same `/iris/v1` JSON:API the web UI uses. `apps` and `builds` are read-only; `app-create` writes: it creates an app record, the one step the App Store Connect API key cannot do (it returns 403) but a signed-in session can. You must be signed in to `appstoreconnect.apple.com`, including two-factor authentication, in the browser chrome-use drives.

## Commands

```sh
chrome-use site appstoreconnect/apps                                  # every app: name, bundle id, SKU, Apple ID
chrome-use site appstoreconnect/apps --bundle_id com.example.app      # just one
chrome-use site appstoreconnect/app-create --name "My App" --bundle_id com.example.app --sku example-app --locale zh-Hans
chrome-use site appstoreconnect/builds --bundle_id com.example.app    # newest uploads and their processing state
```

## Adapters

| adapter | args | returns / does |
| --- | --- | --- |
| `appstoreconnect/apps` | `[--bundle_id]` | Lists the account's apps (up to 200), or only the one with that bundle id. Returns `{ count, apps }`, each `id, name, bundle_id, sku, primary_locale, url` (`id` is the Apple ID; `url` is the app's App Store Connect page). |
| `appstoreconnect/app-create` | `--name --bundle_id --sku [--locale] [--platform] [--version]` | **Writes.** Creates the app record, as the "New App" dialog does, in one compound request (app, first version with its localization, app info with the name). `name` is at most 30 characters and unique across the store; `locale` defaults to `en-US` (e.g. `zh-Hans`, `ja`, `en-GB`); `platform` is `IOS` (default), `MAC_OS`, `TV_OS` or `VISION_OS`; `version` defaults to `1.0`. Returns `{ ok, created, id, name, bundle_id, sku, url }`. |
| `appstoreconnect/builds` | `--bundle_id [--limit]` | Recent builds of one app, newest first, so you can see when an upload is ready for TestFlight. `limit` defaults to 10, max 50. Returns `{ app_id, count, builds }`, each `id, build, state, uploaded, expired, min_os` (`state` is Apple's processing state). If no app has that bundle id it says so and points to `app-create`. |

## Notes

- `app-create` needs the bundle id registered in the developer portal first (the API key can do that). It is idempotent: if an app with that bundle id exists, it returns it with `created: false` instead of making a second one. On failure, `reasons` carries Apple's own messages, such as a name already taken.
- Creating an app needs the Admin or App Manager role; a 403 from a signed-in session says the Apple ID may lack it.
- Sign in first, including two-factor authentication; a person has to do that (`chrome-use session handoff`). A signed-out session returns `hint: "Not signed in…"` instead of an empty list.

## Tests

`node --test appstoreconnect/`

See [CHANGELOG](../CHANGELOG.md) for changes.
