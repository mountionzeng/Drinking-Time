# Conversational creation release — 2026-10-17

## Scope

Application commit `a636f5f2`: story-aware visual prompts, desktop composer avatar simplification, conversational text alternatives, mobile video-intent questions and persisted storyboard previews, and removal of redundant image-workspace headings. Mobile frontend files remain unchanged.

Public landing-page drafts and the independent Alipay worktree are excluded. Completed-work archive rules remain intact. Browser-local image placements are not synchronized into mobile video planning; previews use saved text and confirmed cover and are not automatically adopted into the formal timeline.

## Verification

- Normal suite: 640 files, 5526 tests passed; 64 MySQL tests skipped in the normal suite and run separately against a disposable database.
- Mini-program: 16 files, 215 tests passed.
- TypeScript, 32-migration baseline, 62 feature cards, production build and whitespace checks passed.
- Local `/m`, 390×844: version clarification, real new text generation, refresh/history access and original retention verified. Open-ended video intent generated a persisted preview with original narration; no media generation. Evidence in conversation-version browser QA.
- Exact build manifest: 78 files. No worktree dev server.

## Deployment

- MySQL: 17 files / 64 tests passed against a restricted disposable database; temporary server stopped.
- Application `a636f5f224d0b3d4a8ec1c6ee8e5c27865e87fa4` merged and pushed to main, deployed at 18:16 CST.
- Cloud invocation `t-wl070axna1f98g0` succeeded. All 78 deployed files match the tested manifest.
- Public HTTPS `/healthz`, `/readyz`, `/m`, `/editing` and JS/CSS hashes passed; authentication required and MySQL ready. Google entry/provider redirect checks passed. No logged-in production browser acceptance is claimed.
- Backup `/root/drinking-time-art-20261017/` contains original runtime, SQL dump/checksum and database snapshots. Rollback preflight passed; runtime rollback script preserves database and configuration.
- All 77 business table snapshots, 32 migration records and environment hash unchanged. No migration, local-data import or upload overwrite.
- Feature worktree and branch removed after merge; unrelated main landing/payment notes restored and left uncommitted.
