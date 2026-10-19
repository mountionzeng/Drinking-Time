# Video export release — 2026-10-19

- Application: `6b23c6d8223550ea7822bd39f21343236315bde5`, pushed to main and deployed.
- Cloud invocation: `t-wl070hatrxy0v7k`, Success / exit 0.
- Previous production application: `a2f259528403996409b3f91995b905bb18a3f084`.
- Normal suite: 649 files / 5,557 tests passed; 17 MySQL files / 64 tests skipped in normal suite and executed separately.
- Disposable MySQL: initial run 62 passed / 2 failed due to temporary server binary-log trigger permissions; after correcting only the disposable server configuration, all 4 tests in the affected storyConversation suite passed. All 64 cases covered successfully across these runs; temporary server stopped. No production database credentials or data used.
- TypeScript, production build, 32-migration baseline, feature validation and environment gate passed.
- Production previously lacked FFmpeg/FFprobe. Installed `/usr/local/bin/ffmpeg` from ffmpeg-static 5.3.0's pinned b6.1.1 Linux artifact (reports FFmpeg 7.0.2) and ffprobe from @ffprobe-installer/linux-x64 5.2.0. Older installer FFmpeg lacked amix normalize; replaced before application cutover. Server smoke passed H.264/AAC MP4, tpad and amix normalize/apad.
- 95 deployed file hashes match tested build. HTTPS /healthz, /readyz, /editing, /m and JS/CSS content checks passed. Google entry/provider redirects passed on retry; no claim of a new interactive Google login.
- All 77 business table snapshots, 32 migration records and environment hash unchanged. No migration, account changes, local-data import or source media edits.
- Backup: `/root/drinking-time-export-20261019/`; SQL `/root/drinking-time-export-20261019/mysql/drinking-time-20261019-130559.sql`. Application rollback preflight passed and preserves database/new user data.
- Scope: video-workspace export button, held static images, strict missing-material errors and persistent inline feedback. Custom image text layers and remote-only images are explicitly rejected pending support. Local actual full-pipeline FFmpeg integration evidence is in `2026-10-19-video-export-check.md`; production acceptance here covers runtime dependencies, deployed files and HTTP endpoints, not export of a real production user's story.
