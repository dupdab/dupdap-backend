# Glossary

Domain terms used across the DupDub codebase and docs, defined for how DupDub uses them.

| Term | Definition in DupDub |
| ---- | -------------------- |
| **Merchant** | A business account that creates payments, receives notifications and gets fiat settlements. Authenticates with a JWT or an `X-API-Key`. |
| **Payment** | A request for a customer to pay a USD amount in crypto on Stellar. Moves through `pending → confirmed → settling → settled` (or `failed`, `expired`, `cancelled`, `refunded`). |
| **Reference** | The merchant-facing payment identifier. It is used in hosted payment URLs (`/pay/:reference`) and as the payment memo. |
| **Deposit address** | The Stellar account a customer sends funds to for a payment. |
| **Memo** | A short value attached to a Stellar transaction. DupDub uses it to match an incoming transaction to a payment when funds go to a shared deposit address. |
| **Stellar** | The public blockchain DupDub uses to receive payments. It has fast finality and low fees. |
| **Horizon** | Stellar's REST API. DupDub's monitor polls it for incoming transactions to deposit addresses. |
| **Ledger** | One closed block on the Stellar network, about every 5 seconds. A payment is confirmed once its transaction lands in a closed ledger. |
| **Lumens (XLM)** | Stellar's native asset. Payments can be made in XLM (`amountXlm`). It also pays network fees and account reserves. |
| **USDC** | A USD-pegged stablecoin issued on Stellar by Circle. It is the preferred payment asset because it has no FX exposure (`amountUsdc`). |
| **Asset / Trustline** | A Stellar token other than XLM is identified by code and issuer. An account needs a trustline to hold it, for example USDC. |
| **Soroban** | Stellar's smart-contract platform. DupDub uses Soroban contracts for escrow and on-chain payment state; see [Soroban integration](soroban-integration.md). |
| **Escrow** | Funds held by a Soroban contract after confirmation until they are released for settlement or returned as a refund or cancellation. |
| **Confirmation** | DupDub has detected the customer's on-chain transaction for the expected amount and asset. It emits `payment.confirmed`. |
| **Settlement** | Converting confirmed crypto into fiat and paying it out to the merchant's bank account. It emits `payment.settled` on success and `settlement.failed` on failure. |
| **Rate / FX** | The crypto-to-USD exchange rate used to price a payment and compute settlement amounts. |
| **Slippage** | The difference between the quoted rate and the rate at execution. It is bounded by admin-configured tolerances. |
| **Fee config** | Per-merchant or global platform fees deducted at settlement. |
| **Webhook** | A signed HTTP `POST` DupDub sends to a merchant URL for an event. The body is signed with HMAC-SHA256 using the webhook secret and sent in `x-webhook-signature`; see [Webhooks](webhooks.md). |
| **Notification webhook** | A merchant webhook registered at `PUT /merchants/me/notification-webhook`. It receives `notification.payment.*` events, with the same signing and retries as other webhooks. |
| **Notification preferences** | Per-merchant switches for each channel (`email`, `sms`, `push`, `in_app`, `webhook`) and event. New merchants get email enabled for confirmed, settled and failed payments. |
| **RuntimeConfig** | Admin-editable key/value settings that change behaviour without a deploy, such as `notifications.default_preferences`. |
| **Idempotency key** | A client-supplied key that makes retrying a create request safe, so it never creates a duplicate payment. |
| **AML** | Anti-money-laundering screening applied to payments and merchants. |
