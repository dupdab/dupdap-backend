# API error reference

All API exceptions handled by the global filter include `statusCode`, `error`,
`errorCode`, `message`, `timestamp`, and `path`. Validation messages may be an
array. Branch on `errorCode`, not human-readable messages. Existing client-error
messages are preserved; unexpected exceptions and server failures are logged
privately and return safe recovery instructions. No stack, RPC payload, SQL or
JavaScript runtime message is exposed.

| errorCode                    | HTTP        | Consumer action                                                                                 |
| ---------------------------- | ----------- | ----------------------------------------------------------------------------------------------- |
| API_KEY_EXPIRED              | 401         | Generate a new API key                                                                          |
| HTTPS_REQUIRED               | 426         | Use an HTTPS URL                                                                                |
| TLS_VERSION_UNSUPPORTED      | 403         | Upgrade the client to TLS 1.2 or higher                                                         |
| INVALID_REQUEST              | 400         | Correct the fields described in message                                                         |
| AUTHENTICATION_REQUIRED      | 401         | Sign in or supply valid credentials                                                             |
| ACCESS_DENIED                | 403         | Request the required role or account access                                                     |
| RESOURCE_NOT_FOUND           | 404         | Check the resource identifier and account                                                       |
| METHOD_NOT_ALLOWED           | 405         | Use a supported HTTP method                                                                     |
| NOT_ACCEPTABLE               | 406         | Use a supported API version or format                                                           |
| REQUEST_TIMEOUT              | 408         | Check operation status before retrying                                                          |
| RESOURCE_CONFLICT            | 409         | Refresh state and resolve the conflict                                                          |
| RESOURCE_EXPIRED             | 410         | Create a new request or download link                                                           |
| PAYLOAD_TOO_LARGE            | 413         | Reduce the request size                                                                         |
| RATE_LIMIT_EXCEEDED          | 429         | Wait before retrying                                                                            |
| TRANSACTION_LIMIT_EXCEEDED   | 429         | Wait until reset; the transaction-limit filter also returns retryAfter, reset and X-Limit-Reset |
| ESCROW_PAUSED                | 403         | Retry after escrow operations resume                                                            |
| ESCROW_OPERATION_IN_PROGRESS | 409         | Check the pending escrow operation before retrying                                              |
| PAYMENT_NOT_FOUND            | 404         | Check the payment identifier                                                                    |
| MERCHANT_UPDATE_FAILED       | Bulk result | Check the failed merchant identifier and retry later                                            |
| PAYMENT_EXPIRED              | 400 / 410   | Create a new payment and QR code                                                                |
| INTERNAL_ERROR               | 500         | Retry later or contact support with the request path and timestamp                              |
| UPSTREAM_UNAVAILABLE         | 502         | Check operation status before retrying                                                          |
| SERVICE_UNAVAILABLE          | 503         | Retry later                                                                                     |
| UPSTREAM_TIMEOUT             | 504         | Check operation status before retrying                                                          |
| BLOCKCHAIN_OPERATION_FAILED  | 400 / 5xx   | Check payment/transaction status before retrying; contact support if persistent                 |

Explicit domain error codes override the status fallback for client errors.
Unrecognized HTTP statuses use INTERNAL_ERROR. Server messages are always
redacted, including intentionally thrown HTTP 5xx exceptions.

## Service error audit

The audit covers every `src/**/*service.ts` throw/catch and both exception
filters. Auth, merchants, admin, groups, waitlist, notifications, AML, analytics,
filtering, slippage and webhooks use intentional HTTP client errors; their
validation/authorization messages remain available with status-based codes.
Payment expiry has a domain code and instructs consumers to create a payment.
Settlement approval rejects an invalid state with an actionable 400 response.
Wallet provisioning, encryption, email, backup, cron, Stellar queues/monitors,
and Soroban infrastructure failures contain operator diagnostics; the global
filter masks these at the HTTP boundary and retains server logging/Sentry.
The separate transaction-limit filter, API-key rate-limit guard and TLS middleware include their own errorCode. Bulk merchant update failures also return a safe message and code per failed item.

Internal background job exceptions remain diagnostic for operators; they are
not API error responses. Soroban client failures use the blockchain code rather
than exposing XDR or SDK error text. Validation arrays remain arrays for clients
that render field errors.
