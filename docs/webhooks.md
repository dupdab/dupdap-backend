# Webhook Events

This document describes the webhook event types emitted by the platform, the
payload schema for each event, and example payloads.

All webhooks are delivered as `POST` requests with a JSON body. Every payload
includes the following common envelope fields:

| Field        | Type   | Description                                   |
| ------------ | ------ | --------------------------------------------- |
| `id`         | string | Unique event identifier                       |
| `type`       | string | Event type (see below)                        |
| `created_at` | string | ISO 8601 timestamp of when the event occurred |
| `data`       | object | Event-specific payload                        |

## Event Types

| Event type          | Description                                          |
| ------------------- | ---------------------------------------------------- |
| `payment.confirmed` | A payment has been confirmed on-chain                |
| `payment.settling`  | A payment is in the process of settling              |
| `payment.settled`   | A payment has fully settled                          |
| `payment.failed`    | A payment has failed                                 |

## Payload Schemas

### Common Envelope

```ts
interface WebhookEnvelope<T> {
  id: string;
  type: string;
  created_at: string;
  data: T;
}
```

### `payment.confirmed`

```ts
interface PaymentConfirmedData {
  payment_id: string;
  amount: string;
  currency: string;
  tx_hash: string;
  confirmed_at: string;
}

type PaymentConfirmedEvent = WebhookEnvelope<PaymentConfirmedData> & {
  type: 'payment.confirmed';
};
```

Example:

```json
{
  "id": "evt_1a2b3c",
  "type": "payment.confirmed",
  "created_at": "2024-01-01T12:00:00Z",
  "data": {
    "payment_id": "pay_123",
    "amount": "100.00",
    "currency": "USD",
    "tx_hash": "0xabc123",
    "confirmed_at": "2024-01-01T11:59:00Z"
  }
}
```

### `payment.settling`

```ts
interface PaymentSettlingData {
  payment_id: string;
  amount: string;
  currency: string;
  estimated_settlement_at: string;
}

type PaymentSettlingEvent = WebhookEnvelope<PaymentSettlingData> & {
  type: 'payment.settling';
};
```

Example:

```json
{
  "id": "evt_4d5e6f",
  "type": "payment.settling",
  "created_at": "2024-01-01T12:05:00Z",
  "data": {
    "payment_id": "pay_123",
    "amount": "100.00",
    "currency": "USD",
    "estimated_settlement_at": "2024-01-01T12:10:00Z"
  }
}
```

### `payment.settled`

```ts
interface PaymentSettledData {
  payment_id: string;
  amount: string;
  currency: string;
  settled_at: string;
}

type PaymentSettledEvent = WebhookEnvelope<PaymentSettledData> & {
  type: 'payment.settled';
};
```

Example:

```json
{
  "id": "evt_7g8h9i",
  "type": "payment.settled",
  "created_at": "2024-01-01T12:10:00Z",
  "data": {
    "payment_id": "pay_123",
    "amount": "100.00",
    "currency": "USD",
    "settled_at": "2024-01-01T12:10:00Z"
  }
}
```

### `payment.failed`

```ts
interface PaymentFailedData {
  payment_id: string;
  amount: string;
  currency: string;
  reason: string;
  failed_at: string;
}

type PaymentFailedEvent = WebhookEnvelope<PaymentFailedData> & {
  type: 'payment.failed';
};
```

Example:

```json
{
  "id": "evt_0j1k2l",
  "type": "payment.failed",
  "created_at": "2024-01-01T12:15:00Z",
  "data": {
    "payment_id": "pay_123",
    "amount": "100.00",
    "currency": "USD",
    "reason": "insufficient_funds",
    "failed_at": "2024-01-01T12:15:00Z"
  }
}
```

## Changelog

### 2024-01-01

- Initial documentation of webhook event payloads.
- Added `payment.confirmed`, `payment.settling`, `payment.settled`, and
  `payment.failed` event schemas.
