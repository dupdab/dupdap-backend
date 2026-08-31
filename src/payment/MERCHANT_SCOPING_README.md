# IDOR fix: scope PaymentController/PaymentService to merchantId

## Issue
`getPaymentById()`, `getPaymentByReference()`, `getPaymentStatus()`,
`getPaymentQrCode()`, `getPaymentReceipt()`, and `cancelPayment()` in
`payment.controller.ts` only ever called into `PaymentService` with the
resource id/reference — no `merchantId` was threaded through anywhere. The
live `src/payments/payments.controller.ts` scopes every read/write via
`req.user.merchantId`. Without the same scoping, any authenticated merchant
could fetch or cancel any other merchant's payment by guessing/incrementing
a UUID or reference (a textbook IDOR).

## What was implemented
- `payment.controller.ts`: every handler (`createPayment`, `getPayments`,
  `getPaymentById`, `getPaymentStatus`, `getPaymentQrCode`, `cancelPayment`,
  `getPaymentByReference`, `getPaymentReceipt`) now injects `@Request() req`
  and passes `req.user.merchantId` into the corresponding service call,
  mirroring `payments.controller.ts`.
- `payment.service.ts`: every method that reads or mutates a payment now
  takes a `merchantId` parameter and includes it in the TypeORM `where`
  clause (`getPaymentDetails`, `getPaymentById`, `getPaymentStatus`,
  `generateQrCode`, `cancelPayment`, `getPaymentByReference`,
  `generateReceipt`, `getPayments`, `createPayment`), so a payment belonging
  to a different merchant now resolves to `404 Not Found` instead of being
  returned/mutated.
- `handleNotify` (the internal webhook/status-update path, not
  merchant-authenticated) intentionally still looks up by id only, since it
  runs outside of a merchant request context.

## Why this matters
This closes the cross-merchant IDOR described in the security report: read
and write access to any given payment record now requires the caller's
authenticated `merchantId` to match the record's owner.
