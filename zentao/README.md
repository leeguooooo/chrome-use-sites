# ZenTao bug workflow

English · [中文](README.zh.md)

These adapters target the self-hosted ZenTao at `zentao.pwtk.cc`. Sign in with
Chrome first. Each command uses that browser session. No password or API token
is stored by the adapters. Run `chrome-use site update` to install the pack.
There is no separate `open` step.

## Commands

| Adapter | Required arguments | Optional arguments | Result |
| --- | --- | --- | --- |
| `zentao/bugs` | None | `product`, `assigned`, `status`, `limit` | Bug rows, account IDs, source and matching totals, scan completeness |
| `zentao/bug` | `id` | None | Steps, files, actions, and deduplicated inline images |
| `zentao/bug-image` | `id`, `image` | None | Verified `image_url` and `image_uid` |
| `zentao/bug-comment` | `id`, `comment` | `image_url`, `image_uid` | Verified new comment action |
| `zentao/bug-resolve` | `id`, `resolution` | `build`, `to`, `comment`, `image_url`, `image_uid` | Verified resolution or an unchanged result |

```sh
chrome-use site zentao/bugs --product 35 --assigned self --status active --limit 100
chrome-use site zentao/bugs --product 35 --status all --limit 1000
chrome-use site zentao/bug 42 --json
chrome-use site zentao/bug-image 42 --image ./config.png --json
```

Pass the returned image URL and UID together to publish the image in a comment
or resolution. The upload command alone does not publish a comment or change
bug status. These commands write as the signed-in user.

```sh
chrome-use site zentao/bug-comment 42 --comment 'Configuration screenshot attached.' \
  --image_url https://zentao.pwtk.cc/zentao/file-read-99.png --image_uid UPLOAD_UID
chrome-use site zentao/bug-resolve 42 bydesign --to qa --comment 'The configured ranges share an endpoint.'
```

`comment` also accepts `@file`. Images must be local PNG, JPEG, GIF, or WebP
files of at most 10 MB. `bug-image` requires a chrome-use version whose file
arguments support `elementRelayUpload`. It returns `unsupported_upload` on older
versions. Other deployments need a domain change and endpoint verification.

## List and inspect bugs

Without `product`, `bugs` defaults to the native assigned-to-me list. With
`product`, it defaults to all assignees. `assigned` accepts `self`, `all`, or an
exact account ID. Display names are returned separately and are never used as
account filters. `status` accepts `all`, `active`, `resolved`, or `closed`.
`limit` defaults to 50 and accepts integers from 1 through 10000.

The product endpoint defaults to unclosed bugs. These adapters request
`status=all` and filter locally because individual status queries on this
installation can return an empty list. `total` is the source count.
`matchedTotal` is available only after a complete scan. `complete` describes
the scan. `truncated` means some matching records may be omitted. A repeated
page, changing total, or failed page returns an error, not a complete list.

`bug` merges images from steps and every action comment. Each action also
returns its own images. Only this installation's `file-read` image references
are included. Download them with `chrome-use download-url URL ./image.png`.

## Verify writes

Comments are confirmed against a new action ID and the submitted text and
image references. Resolve also checks the requested state, resolution,
assignee, and build. The default build is `trunk`. Supported resolutions are
`fixed`, `bydesign`, `postponed`, `notrepro`, `willnotfix`, `tostory`,
and `external`, subject to the server's rules. Duplicate resolution needs a
separate target bug field and is not supported by this command.

Resolving an already matching resolved bug returns `unchanged` without a POST.
Other requests against resolved or closed bugs return `state_conflict`.
Use `bug-comment` to add a note instead.

A write that cannot be confirmed returns `action_outcome_unknown` with
`retryable: false`. Read the bug before deciding whether another write is
needed. Do not automatically retry. An unauthenticated read or prewrite check
returns `loginRequired` for chrome-use's login flow.

## Tests and live verification

Run `node --test zentao/*.test.cjs`. Tests use synthetic responses and never
post to a real bug. Live read checks confirmed product filtering, assigned
account filtering, closed records, and images in an existing action comment.
The new upload and strict write-verification branches have offline coverage;
they have not been used to create test uploads, comments, or resolutions.
The image adapter removes its temporary file input in `finally` and leaves no
named page globals or patched page APIs.
