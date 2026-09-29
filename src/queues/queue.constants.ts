/**
 * Canonical Bull queue names for the whole backend.
 * Every module that registers or injects a Bull queue must use these constants.
 */
export const QUEUE_NAMES = {
  settlement: 'settlement',
  webhookDelivery: 'webhook-delivery',
  emailDelivery: 'email-delivery',
  stellarMonitor: 'stellar-monitor',
  sorobanEventDlq: 'soroban-event-dlq',
} as const;

export const QUEUE_LIST = Object.values(QUEUE_NAMES);

export const DEFAULT_QUEUE_JOB = 'dispatch';

/** Job names for the webhook / email delivery processors. */
export const WEBHOOK_DELIVERY_JOB = 'deliver';
export const EMAIL_DELIVERY_JOB = 'send';

/** Aliases kept for call-sites that import the queue name directly. */
export const WEBHOOK_DELIVERY_QUEUE = QUEUE_NAMES.webhookDelivery;
export const EMAIL_DELIVERY_QUEUE = QUEUE_NAMES.emailDelivery;
