// DupDub merchant flow: create payment, poll status, verify webhook.
// Usage: DUPDUB_API_KEY=... node merchant-flow.js
const crypto = require('crypto');

const BASE_URL = process.env.DUPDUB_BASE_URL || 'http://localhost:3000/api/v1';
const API_KEY = process.env.DUPDUB_API_KEY;
const FINAL_STATUSES = ['settled', 'failed', 'expired', 'cancelled', 'refunded'];

async function api(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

function createPayment() {
  return api('POST', '/payments', {
    amountUsd: 25.0,
    description: 'Order #1001',
    customerEmail: 'customer@example.com',
  });
}

async function pollStatus(paymentId, { intervalMs = 5000, timeoutMs = 15 * 60 * 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const payment = await api('GET', `/payments/${paymentId}`);
    console.log(`status=${payment.status}`);
    if (FINAL_STATUSES.includes(payment.status)) return payment;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Timed out waiting for payment');
}

/** Verify `x-webhook-signature` against the raw request body. */
function verifyWebhook(rawBody, signature, secret) {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature || '', 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Example Express handler (keep the raw body for signature checks):
// app.post('/webhooks/dupdub', express.raw({ type: 'application/json' }), (req, res) => {
//   if (!verifyWebhook(req.body, req.get('x-webhook-signature'), process.env.DUPDUB_WEBHOOK_SECRET)) {
//     return res.sendStatus(401);
//   }
//   const { event, data } = JSON.parse(req.body);
//   console.log('received', event, data);
//   res.sendStatus(200);
// });

async function main() {
  if (!API_KEY) throw new Error('Set DUPDUB_API_KEY');
  const payment = await createPayment();
  console.log(`created payment ${payment.id} (reference ${payment.reference})`);
  const final = await pollStatus(payment.id);
  console.log(`final status: ${final.status}`);
}

module.exports = { createPayment, pollStatus, verifyWebhook };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
