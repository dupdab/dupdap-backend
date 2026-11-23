# #808 — Scope `findByReference()`

## Status
Partial. `src/payments/payments.service.ts` in this sandbox is empty (0 lines), so the
service method itself could not be edited. The public pay-page caller has been updated to
the new signature.

## Approach
1. In `src/payments/payments.service.ts`, change the signature to:

   ```ts
   async findByReference(
     reference: string,
     options: { merchantId?: string; scope?: 'public' | 'merchant' | 'admin' } = {},
   ): Promise<Payment> {
     const where: FindOptionsWhere<Payment> = { reference };
     if (options.scope !== 'public') {
       if (!options.merchantId) {
         throw new BadRequestException('merchantId is required for scoped lookups');
       }
       where.merchantId = options.merchantId;
     }
     const payment = await this.paymentRepository.findOne({ where });
     if (!payment) throw new NotFoundException('Payment not found');
     return payment;
   }
   ```

   Unscoped behaviour is preserved only when `scope === 'public'` (customer pay page).

2. Audit callers (already done):
   - `src/payments/payments.controller.ts` `PublicPaymentController.getByReference` — public
     pay page, passes `{ scope: 'public' }` (done).
   - `src/payments/payments-admin.controller.ts` — no current caller; any new admin lookup
     must pass `{ scope: 'admin' }` and, for merchant-scoped admins, `merchantId`.
   - `src/payments/payment-import.queue.ts`, `payments-soroban.listener.ts` — no callers.

3. Tests:
   - `src/payments/payments.controller.spec.ts:251` expects
     `findByReference('PAY-abc123')`; update to
     `findByReference('PAY-abc123', { scope: 'public' })`.
   - Add a service test: `findByReference('PAY-123', { scope: 'merchant', merchantId: 'other' })`
     with the repo returning `null` → expect `NotFoundException` (cross-merchant lookup 404).

## Done when
- Service scopes by `merchantId` for non-public callers and throws 404 on cross-merchant.
- Controller spec updated; new cross-merchant 404 test passes.
