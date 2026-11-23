# 804 — `confirmPayment()` merchant notification email

## Status
Partly solved. The notification capability is built; the call site is blocked.

## Built
- `src/notifications/notifications.service.ts`: added `notifyMerchant(payload)` plus
  `MerchantPaymentConfirmedPayload`. It enqueues the confirmation email through the
  existing `enqueueEmail()` queue path (retries/backoff from `QueueConfigService`).
- `src/payments/payments.service.spec.ts`: notification service mocked with
  `notifyMerchant`, plus unit tests for enabled / disabled preference and for a
  failing notification not blocking confirmation.

## Blocker
`src/payments/payments.service.ts` is empty in this checkout (0 lines), so
`confirmPayment()` does not exist here and cannot be patched. The spec file still
references it, so the file must be restored from history before wiring.

## Remaining work
1. Restore `src/payments/payments.service.ts` (inject `NotificationsService` and
   `MerchantsService`; both modules are already imported by `payments.module.ts`).
2. In `confirmPayment()`, after the payment is saved as `CONFIRMED`:
   ```ts
   try {
     const merchant = await this.merchants.findOne(payment.merchantId);
     if (merchant?.paymentConfirmedEmailEnabled) {
       await this.notifications.notifyMerchant({
         merchantEmail: merchant.email,
         merchantName: merchant.businessName,
         paymentId: payment.id,
         reference: payment.reference,
         amountUsd: payment.amountUsd,
         amountUsdc: payment.amountUsdc,
       });
     }
   } catch (err) {
     this.logger.warn(`Merchant confirmation notification failed: ${err.message}`);
   }
   ```
   Keep it non-blocking, mirroring the existing AML check handling.
3. Run `npm test -- payments.service.spec` and the linter.

## Done when
Confirmation enqueues exactly one merchant email when the preference is on, none
when off, and a notification failure never fails the confirmation.
