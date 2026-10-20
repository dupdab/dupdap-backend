# Frontend QR Code Integration Guide

Payment creation returns `qrCode` (base64 data URL), `expiresAt` (ISO 8601 timestamp),
and `reference`.

## Rendering an expiry indicator

1. Read `expiresAt` from `POST /payments` or `GET /pay/:reference`.
2. Compute `msLeft = new Date(expiresAt).getTime() - Date.now()`.
3. Render a countdown ring/bar; when `msLeft <= 0`, show "QR expired — create a new payment"
   and stop polling.
4. The QR payload itself also carries `&expires=<ISO>` so a scanned payload can be
   validated client-side without a server round-trip.

```ts
const res = await fetch('/api/v1/payments', { method: 'POST', body });
const { qrCode, expiresAt, reference } = await res.json();
// qrCode -> <img src={qrCode} />
const msLeft = new Date(expiresAt).getTime() - Date.now();
```

## Expired scans

`GET /pay/:reference` returns **410 Gone** with `Payment QR code has expired`
once `expiresAt` has passed. Treat 410 as terminal: do not retry the same
reference, create a fresh payment instead.
