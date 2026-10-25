# WeChat Channels cover selection

English · [中文](README.zh.md)

`cover-select` complements the existing OpenCLI `wechat-channels/publish`.
It operates only on a new `/platform/post/create` form without query parameters;
it never publishes, saves the draft or changes an existing work.

```sh
chrome-use site wechat-channels/publish ./clip.mp4 --manual true
chrome-use site wechat-channels/cover-select --cover ./portrait.png --cover-mode upload
```

Upload mode requires a chrome-use build whose file objects advertise
`elementRelayUpload: true`, including the relay-safe `setOn(element)` fix.
Older hosts are refused before opening the editor; released 1.5.265 does not
provide that capability. `cover` accepts JPG/PNG. The adapter finds the actual
input inside the wujie shadow root, uses native `args.ui` input for controls,
and confirms a loaded, changed 3:4 preview after the editor closes. It handles
inline cropping and the observed optional nested crop dialog.

`--cover-mode keep` reads an already selected, loaded preview without changing
it. `--cover-mode confirm` explicitly accepts the current visible crop without
uploading again; inspect it first after an interrupted operation. An unconfirmed
operation returns `cover_confirmation_required`, never a success to retry blindly.
AI generation, arbitrary frame selection and existing-work cover updates are
not supported. No paid generation is invoked.

Validation: sanitized real widget fixture, offline normal/fault controls, and
one complete upload/crop/preview flow on an owned test create form. The visible
preview was verified at 720×960. The QA video was removed and the owned test tab
was closed without saving a draft or publishing. This does not validate every
account variant or update of a published work.

Recorded [QA acceptance metadata](fixtures/qa-acceptance.json) includes a cropped fixture preview and the separate complete-adapter result.
