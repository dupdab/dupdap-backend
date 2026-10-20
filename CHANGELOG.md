# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Payment QR codes carry an expiry indicator: `expiresAt` ISO timestamp in
  responses, expiry baked into the QR payload, 410 Gone on expired scans (#545).
- Audit logging for merchant configuration changes with masked bank account
  fields and paginated `GET /merchants/audit-log` (#543).
- CORS configuration tests and production startup validation for
  `ALLOWED_ORIGINS` (#542).

## [1.0.0] - 2026-10-19

### Added
- Initial public API release.
