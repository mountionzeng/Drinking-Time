# Admin compute release — 2026-10-18

- Application commit: e448b6ff141953b9b988f0689eddb7a840627640, pushed to origin/main.
- Production invocation: t-wl070f0tdai60hs, Success / exit 0.
- Previous production application: d65e8fb16ee867bc326d317f7e3d204b4821d671.
- 10 targeted tests passed (admin API, page, existing account statement and admin pages). TypeScript, feature validation and production build passed.
- Backup: /root/drinking-time-admin-compute-20261018/mysql/drinking-time-20261018-214632.sql and before-runtime.tgz. Application-only rollback.py preflight passed; preserve newer database data.
- All 95 build files match. 77 business tables, 32 migrations and .env unchanged during cutover.
- HTTPS health/readiness, desktop /editing, mobile /m and JS/CSS asset hashes passed.
- Production repository router calls against real MySQL: exact email lookup and statement balance consistency passed for both user-specified accounts. Gmail account already admin; 163 account remains user. No role or billing mutation.
- Anonymous and regular-user router calls for list and another account statement return FORBIDDEN. Real browser normal-user navigation to /admin/compute redirects to /editing.
- Entry: /admin/users → 算力账单; direct /admin/compute. Current browser is not administrator; authenticated administrator visual/click acceptance remains pending login. No claim of full browser acceptance.
- Only ledger-integrated calls are represented; estimated costs are not supplier invoices. No AI calls were made during verification.
