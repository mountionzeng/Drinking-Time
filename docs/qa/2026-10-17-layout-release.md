# Layout and module editing release

## Scope

Includes the October 16 image/layout workspaces, text/image modules, mobile module controls, cross-page movement, page insertion/deletion and renumbering, text emphasis/backdrops, full-text and selected-page copying, selected-module chat and passive local operation memory, complete story image warehouse and rendered artwork archive.

The older unapproved /shiguang public landing page and independent Alipay worktree remain local. The proposed mobile image top-level navigation and new mobile video editing workflow are not implemented in this release; existing mobile image creation/module editing remain available.

## Pre-release evidence

- Exact staged source exported without real credentials or business data; no additional dev server.
- Normal suite: 638 files / 5499 tests. Initial run passed 5497 tests; two tests exceeded the unchanged 5-second limit under parallel load. Both affected files passed all 13 tests on a focused retry.
- TypeScript, 32 migration baseline entries, 62 release feature cards and production build passed.
- Mini-program: 16 files / 215 tests passed.
- Browser: explicitly saved the current four-page artwork; warehouse increased from 12 to 16 images, original content and layout preserved. No paid generation.
- Dedicated MySQL integration: 17 files / 64 tests passed; restricted disposable account verified, temporary server stopped.

## Production release

- Application commit `f209b7c3418adc3a65c441cde30776e0835a9422` pushed to main and deployed on 2026-10-17 00:20 CST.
- Cloud invocation `t-wl07089nnit9wjk` succeeded. Four changed files uploaded, all 78 deployed files match the tested build manifest.
- Backup: `/root/drinking-time-layout-20261016/`, including original runtime, complete SQL dump/checksum and database snapshots. Rollback: `python3 /root/drinking-time-layout-20261016/rollback.py`; its read-only preflight passed.
- All 77 business table snapshots, 32 migrations and environment unchanged. No migration, local business-data import or upload overwrite.
- Public HTTPS healthz/readyz, /m, /editing and JS/CSS content hashes passed; authentication required, MySQL ready. Google entry/provider redirects passed. HTTP retains existing 301 redirect.
- Desktop browser production check could not connect (`ERR_CONNECTION_CLOSED`); server-side public HTTPS verification passed after transient DNS retries. Do not count this release as logged-in production browser acceptance.
- Local browser screenshot: `/tmp/layout-release-20261016/artwork-archived.png`.

## Limits

Operation memory and editable module drafts remain browser-local. Explicitly archived artwork copies are stored with the story. Real iOS/Android devices, third-party paste targets and actual model recommendation quality were not tested in this release.
