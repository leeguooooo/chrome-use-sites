<!-- Repo rules: CONTRIBUTING.md. CI (`node --test`) fails when the docs part is missing. -->

## What changed

## Checklist

- [ ] `<pack>/README.md` **and** `<pack>/README.zh.md` describe every adapter in the pack (new args, fields and behaviour included)
- [ ] `CHANGELOG.md` has a dated entry (`## YYYY-MM-DD`) naming each adapter this PR adds or changes
- [ ] New adapter files are listed in `PACKS` in `install.sh`
- [ ] `node --test` passes locally; new behaviour has a stubbed test (fixtures trimmed, nothing private)
- [ ] Live checks followed AGENTS.md (one run per adapter on accounts that ban scripted traffic; nothing published or deleted that wasn't asked for)
