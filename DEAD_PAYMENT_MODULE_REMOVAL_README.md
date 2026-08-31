# Removal of the unused src/payment module

## Issue
`src/payment/payment.module.ts` defined a `PaymentModule` that was never
imported by `src/app.module.ts` or any other module in the repo (confirmed
via a repo-wide grep for `PaymentModule`). It was a full parallel
implementation of payment creation/listing/status/QR/cancel/receipt
endpoints living alongside the actually-wired `src/payments/` module.

## Impact
- Maintainers reading `src/payment/payment.controller.ts` could reasonably
  believe endpoints like `GET /:id/receipt` and `GET /:id/qr-code` were
  live in production; they were not.
- It doubled the surface area someone had to read to find the real payment
  logic.
- It contained its own bugs (missing `MerchantGuard`, doubled `api/v1`
  route prefix, and a cross-merchant IDOR — all fixed in earlier commits on
  this branch) that would never be caught by integration testing because
  nothing exercised the module end-to-end via the running app.
- `src/payments/` is materially more complete (batch payment creation,
  refunds, a Soroban payment listener, stats, and existing test coverage),
  confirming it is the intended implementation.

## What was implemented
Deleted `src/payment/` in its entirety (`payment.module.ts`,
`payment.controller.ts`, `payment.service.ts`, `idempotency.interceptor.ts`,
and the READMEs added while triaging its individual bugs), per the
suggested fix: "Delete src/payment/ entirely if src/payments/ is the
intended implementation." Two competing implementations of the same
payment domain should not both persist in the tree.

Note: `src/auth/guards/merchant.guard.ts` (added while fixing the missing
guard import) was left in place as a small, generically useful guard for
scoping any future route to an authenticated merchant, even though its
original caller is now gone.
