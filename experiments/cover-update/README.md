# Offline cover-update transaction

English · [中文](README.zh.md)

Draft implementation for chrome-use issue #736. This folder has no live browser
or HTTP driver, is not in `install.sh`, and adds no `site */cover-update` command.
It cannot change a real work. Its tests use synthetic identifiers and snapshots.

`createPlan(snapshot, files)` returns a confirmation-required plan tied to the
exact string work id, platform, persisted cover fingerprint, revision, known
editing restrictions, image SHA-256 values, and required ratios. It surfaces
review risk and WeChat's possible one-modification limit before execution.
Unknown restrictions or an unavailable remaining-edit count block WeChat updates.
The plan's SHA-256 is a consistency check, not authentication or a server token.

`applyPlan` requires the exact reviewed plan id and a future injected driver:

- `inspect(id)`: read the persisted identity, revision, cover fingerprint and
  restrictions. This is separate from the unsaved editor preview.
- `prepare(files, baseline)`: recompute actual local file hashes before upload,
  verify the requested images and every crop ratio, then return the exact
  expected persisted cover fingerprint and file fingerprints. Never save here.
- `commit(receipt)`: save that prepared edit once, without internal retry.

It also requires a durable journal. `claim({platform,id,planId})` must atomically
reserve the work across processes and distinct plans; `record(receipt)` must
persist the intended cover fingerprint before commit. A reservation remains held
after an unknown outcome. Do not release it until read-only reconciliation and
an explicit operator decision. The test journal is memory-only, suitable only
for fixtures; no production journal or live driver is included.

The transaction rechecks persisted state and restrictions after preparation.
Stale state prevents commit. A thrown/failed commit response is followed by one
read-only check; matching persisted state can verify the result. Otherwise it
returns `action_outcome_unknown`, `retryable: false`, and the recorded receipt.
`reconcile(receipt, snapshot)` only checks later evidence and never writes.

Run `node --test experiments/cover-update/transaction.test.js`. Platform driver
integration requires sanitized existing-work editor samples, review/save/error
states, real restriction semantics and persisted readback evidence. New-post
editor samples are insufficient to claim those integrations work. No existing
work was modified to develop or test this draft.
