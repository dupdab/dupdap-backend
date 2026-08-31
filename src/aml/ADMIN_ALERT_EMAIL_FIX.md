# AML alert email config key fix

## What was wrong

`src/aml/aml.service.ts` read `ADMIN_EMAIL` from config to decide whether to
send an AML alert email. That variable is not documented anywhere:
`.env.example` and `README.md` only define `ADMIN_ALERT_EMAIL`, and
`src/alerts/admin-alert.service.ts` (the other admin-alert code path in the
repo) already uses `ADMIN_ALERT_EMAIL`.

Net effect: in any environment set up per the documented `.env.example`
(`ADMIN_ALERT_EMAIL` set, `ADMIN_EMAIL` unset), `AmlService.createFlag()`
silently skipped `notificationsService.enqueueEmail()` — AML alert emails
never sent, with no warning logged.

## What changed

- `src/aml/aml.service.ts`: `createFlag()` now reads `ADMIN_ALERT_EMAIL`
  (matching `AdminAlertService`) instead of `ADMIN_EMAIL`.
- Added a `logger.warn` when `ADMIN_ALERT_EMAIL` is unset, so a missing
  config value is visible in logs instead of failing silently.

## Why not just document `ADMIN_EMAIL` instead

`ADMIN_EMAIL` was never intentionally a separate variable — it appeared
nowhere else in the codebase, docs, or `.env.example`. Aligning on the
already-documented `ADMIN_ALERT_EMAIL` key avoids adding a second,
redundant admin-contact setting.
