# Duplicate API prefix fix

## Issue
`main.ts` calls `app.setGlobalPrefix(apiPrefix)` (defaulting to `api/v1`) for
every controller in the application. `payment.controller.ts` additionally
hardcoded `@Controller('api/v1/payments')`, so if this controller were ever
registered its effective routes would resolve to
`/api/v1/api/v1/payments/...` instead of the expected `/api/v1/payments/...`.

## What was implemented
Changed the decorator to `@Controller('payments')`, letting the global
prefix apply exactly as it does for every other controller in the codebase
(e.g. `src/payments/payments.controller.ts`).

## Why this matters
Without this fix, "reviving" this module by wiring it into `AppModule`
would silently produce unreachable, undocumented routes rather than the
documented `/api/v1/payments/...` paths.
