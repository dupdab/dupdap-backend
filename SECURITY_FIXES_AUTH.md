# Auth security fixes

Branch: `fix/auth-jti-suspended-apikey-lookup`

## 1. Missing `jti` in signed JWTs (bug)
`AuthService.signToken()` now includes a unique `jti` (`crypto.randomUUID()`)
in every issued token. `JwtStrategy.validate()` already fell back to
`payload.jti ?? payload.sub` for the blacklist/session cache key — without a
`jti`, every token for a given merchant shared the same key, so revoking one
session would have blacklisted all of that merchant's sessions/devices at
once. With a per-token `jti`, blacklist/session-cache keys are now per-token.

## 2. Suspended merchants could still log in
`AuthService.login()` verified the merchant exists and the password matches,
but never checked `merchant.status`. A suspended merchant (e.g. flagged for
fraud/AML) with correct credentials could still obtain a valid access token.
`login()` now throws `UnauthorizedException('Account suspended')` when
`status === MerchantStatus.SUSPENDED`.

## 3. Suspended status wasn't re-checked for existing tokens
Even after fixing (2), a merchant suspended *after* issuing a token could
keep using that token for its full lifetime. `JwtStrategy.validate()` now
re-checks `merchant.status` in its DB-fallback path and rejects suspended
accounts.

## 4. Linear bcrypt scan on every API-key request (perf / DoS)
`AuthService.findMerchantByApiKey()` loaded every merchant with a non-null
`apiKeyHash` and ran `bcrypt.compare` in a loop until it found a match. This
is invoked on every request authenticated via `X-API-Key`
(`JwtAuthGuard.canActivate()`), making latency scale linearly with merchant
count and giving any client an easy CPU-exhaustion lever.

Added an indexed `apiKeyLookupHash` column (SHA-256 hex digest of the raw
key) on `Merchant`. `MerchantsService.generateApiKey()` now populates it
alongside the existing bcrypt hash. `findMerchantByApiKey()` looks up the
single candidate row by `apiKeyLookupHash` (O(1), indexed, unique) and only
then runs one `bcrypt.compare` against that candidate.

Migration: `src/database/migrations/1772300000002-AddMerchantApiKeyLookupHash.ts`.

**Note:** merchants with an API key issued before this migration will need
to regenerate it — the raw key needed to compute the new lookup hash can't
be recovered from the existing bcrypt hash.
