## Unreleased

- **Breaking:** all HTTP errors now use `{ statusCode, error, message, requestId }`.
  `message` can be a string or validation message array. Clients must use `requestId`
  instead of `timestamp`/`path` and read retry/reset metadata from response headers.
- Admin operations and common errors are documented in `/docs` and `openapi.json`.
- Merchant owners can invite team emails with OWNER, DEVELOPER, or VIEWER access.
  Invitees register/sign in with their own credentials and select the merchant using
  `X-Merchant-ID`. Only owners manage teams. Team API keys are generated at
  `POST /merchant/team/api-keys`; permissions are resolved from current membership
  on every request, so demotion/removal immediately restricts/revokes keys.

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Webhook signature verification guide in the README (Node.js, Python, PHP),
  replay protection guidance, and `POST /webhooks/test` to send a signed test
  event to all active webhooks (#498).
- Payment QR codes carry an expiry indicator: `expiresAt` ISO timestamp in
  responses, expiry baked into the QR payload, 410 Gone on expired scans (#545).
- Audit logging for merchant configuration changes with masked bank account
  fields and paginated `GET /merchants/audit-log` (#543).
- CORS configuration tests and production startup validation for
  `ALLOWED_ORIGINS` (#542).

## [1.0.0] - 2026-10-19

### Added
- Initial public API release.
