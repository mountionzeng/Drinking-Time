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
- Dedicated MySQL integration and deployment results will be recorded after completion.

## Limits

Operation memory and editable module drafts remain browser-local. Explicitly archived artwork copies are stored with the story. Real iOS/Android devices, third-party paste targets and actual model recommendation quality were not tested in this release.
