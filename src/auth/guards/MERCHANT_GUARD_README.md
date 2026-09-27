# MerchantGuard implementation

## Issue
`src/payment/payment.controller.ts` imported `MerchantGuard` from
`../auth/guards/merchant.guard`, but that file did not exist anywhere in the
repository. Any standard `tsc`/Nest build that includes all files under `src/`
would fail to compile because of this missing import.

## What was implemented
Added `src/auth/guards/merchant.guard.ts`, a `CanActivate` guard that mirrors
the existing `AdminGuard` pattern. It runs after authentication guards have
populated `request.user` and rejects the request with a `403 Forbidden` if
`user.merchantId` is not present, ensuring downstream handlers can safely
assume a merchant context is available before scoping data access to it.

## Why this matters
This guard is a prerequisite for fixing the IDOR issue in
`payment.controller.ts` (see the merchant-scoping fix), since every handler
needs a guaranteed `merchantId` on the request before it can scope queries.
