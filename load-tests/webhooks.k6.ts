import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ─── Custom metrics ───────────────────────────────────────────────────────────
const errorRate = new Rate('webhook_error_rate');
const deliveryLatency = new Trend('webhook_delivery_latency', true);
const deliveries = new Counter('webhook_deliveries_total');

// ─── Options ──────────────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    webhook_burst: {
      executor: 'ramping-arrival-rate',
      startRate: 50,
      timeUnit: '1m',
      preAllocatedVUs: 20,
      maxVUs: 100,
      stages: [
        { target: 500, duration: '2m' }, // ramp to 500 deliveries/min
        { target: 500, duration: '2m' }, // sustain burst
        { target: 0, duration: '1m' }, // cool down
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<600'],
    webhook_error_rate: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000/api/v1';

function jsonHeaders(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

export function setup() {
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: 'k6_shared@test.com', password: 'K6TestPass123!' }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  return { token: res.json('accessToken') as string };
}

// Exercises webhook delivery throughput: list registered webhooks and
// fetch recent delivery attempts, simulating dashboard polling under burst load.
export default function (data: { token: string }) {
  const start = Date.now();
  const res = http.get(`${BASE_URL}/webhooks?page=1&limit=20`, {
    headers: jsonHeaders(data.token),
  });
  deliveryLatency.add(Date.now() - start);
  const ok = check(res, { 'list webhooks 200': (r) => r.status === 200 });
  errorRate.add(!ok);
  if (ok) {
    deliveries.add(1);
  }
  sleep(0.05);
}
