# Desktop English interface — 2026-11-02

## Scope

Extend the existing explicit UI dictionary and context to desktop navigation, story chat, book/chapters, creation menus, manuscript/layout dialogs, storyboard/video tools, subtitle and sound tracks, memories/bookshelf, login and WeChat import, account profile and payment labels. User stories, titles, names, chat messages, generated plans, asset names and model/provider free text remain unchanged. No global DOM translation, no changes to account identity, wallet amounts, generation requests, payment offers, database or server configuration.

The main checkout contains unrelated uncommitted video work. Release source is `/tmp/desktop-ui-english-20261102/src`, reconstructed from `/tmp/alipay-enable-20261102/src` using this task's before/after changes. Conflicts keep the deployed functionality and translate its existing controls; unpublished video workflow additions are excluded. Backups and transformation/audit artifacts are in `/tmp/desktop-ui-english-20261102/before`.

## Validation

- Main checkout: 489 targeted tests passed after restoring JSX spacing and updating direct-function hook mocks.
- Isolated release: 1,255 tests across 194 suites; two source-string assertions needed updates to reflect translated aria-labels. The affected suites passed in the final 69-test rerun. No behavior assertion was removed.
- Added English SSR coverage for desktop panel labels and accessible Hide/Show labels, generation menu/options/prerequisites, and WeChat import controls with Chinese story title preserved.
- Dictionary English entries contain no Han characters; existing placeholder parity tests pass for English and French.
- Main and isolated TypeScript checks pass. Isolated build and its required draft-safety checks pass.
- Browser on main localhost:3000: English Book, chat, create menu, chapter editor, Video/storyboard, subtitle/audio controls, column labels, image roles and credits verified. Chinese story content and account name remain unchanged.
- Language switch English → 中文 → English preserves unsent `Language switch check — 不发送`; test input cleared without sending. No story edits or paid generation performed.
- Screenshot: `/tmp/desktop-ui-english-20261102/english-menu.png`.

## Limits

New English entries retain the previous Chinese fallback for French; existing French translations are preserved. French completeness is not claimed. Account preference remains browser-local. Generated content and server/provider diagnostic text retain source language. Legacy helper-generated notifications and administration-only screens are not comprehensively covered by this pass; they require further explicit UI localization rather than translating user/API payloads.

## Release

Published `desktop-ui-english-20261102`, followed by `desktop-ui-english-polish-20261102` for the WeChat account label, theme name, and complete inbox sentence. Final production manifest: `/opt/Drinking-Time/dist.release-desktop-ui-english-polish-20261102.json`. All 115 artifact hashes and ready/mysql/required passed. Only the JS bundle, index.html, and app-release.json changed. Backend and environment hashes remain unchanged; no process restart. Old assets retained. Backups: `dist.bak-desktop-ui-english-20261102` and `dist.bak-desktop-ui-english-polish-20261102`.

Production browser verified the optional WeChat import prompt, Book editor, navigation, account menu, English preference, `WeChat account`, and `Nayin Five Elements`. User name 岱 and balance 15.00 remain unchanged. Final screenshot: `/tmp/desktop-ui-english-20261102/production-english-profile.png`. The final sentence/identity polish passed 11 targeted tests and rebuilt successfully. Local CLI public HTTPS checks failed with a TLS transport error; browser HTTPS loaded the final new copy, and server-side artifact hashes passed. No independent public-CDN hash claim is made.
