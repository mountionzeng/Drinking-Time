# Share-back reminder release — 2026-10-20

- Application: `18b16238` "feat(sharing): remind the author when a friend shares back", pushed to main and deployed.
- Previous production application: `6b23c6d8223550ea7822bd39f21343236315bde5`.
- Scope: new authenticated `storyContextShare.shareBackInbox` query; desktop story menu red dot + up to 3 share-back items; mobile stories page "朋友分享回来的" card with unread dots; en/fr messages. No contributor userId, token or requestHash returned to client.
- Normal suite: 654 files / 5,582 tests passed; 17 MySQL files / 64 tests skipped. MySQL integration suite not run (no `TEST_MYSQL_DATABASE_URL`).
- TypeScript, production build, 32-migration baseline (latest 0031), feature validation and environment gate passed.
- No schema or migration diff since `6b23c6d8`; no database, `.env`, nginx or certificate changes.
- Deploy: dist `public` + `index.js` tarball, sha256 matched both ends; PM2 `drinking-time` online after restart.
- Backups: `/opt/Drinking-Time/dist.bak-20261020133750-18b16238-public`, `/opt/Drinking-Time/dist.bak-20261020133750-18b16238-index.js`.
- HTTPS `/`, `/editing`, `/readyz` returned 200; entry bundle `/assets/index-Byhx0tvS.js` 200; `shareBackInbox` returns 401 without login (expected). Error log shows only routine missing-session-cookie entries.
- Temporary release files removed locally and on server.

## Known gaps

- Formal-site two-account acceptance (A shares → B shares back → A sees reminder) not yet performed; local server is single-identity.
- Seen state is stored per browser (localStorage), so reminders are not synced across devices.
- Inbox scans only the author's 40 most recent stories.
