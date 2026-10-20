import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ─── Custom metrics ───────────────────────────────────────────────────────────
const errorRate = new Rate('settlement_error_rate');
const batchLatency = new Trend('settlement_batch_latency', true);
const statusLatency = new Trend('settlement_status_latency', true);

// ─── Options ──────────────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    settlement_batch_load: {
      executor: 'constant-arrival-rate',
      rate: 200, // 200 settlement reads/min
      timeUnit: '1m',
      duration: '5m',
      preAllocatedVUs: 20,
      maxVUs: 50,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<800'],
    settlement_error_rate: ['rate<0.01'],
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

// Exercises settlement batch processing at scale: list settlements and
// poll individual settlement status (the batch flush path).
export default function (data: { token: string }) {
  if (Math.random() < 0.6) {
    const start = Date.now();
    const res = http.get(`${BASE_URL}/settlements?page=1&limit=20`, {
      headers: jsonHeaders(data.token),
    });
    batchLatency.add(Date.now() - start);
    errorRate.add(!check(res, { 'list settlements 200': (r) => r.status === 200 }));
  } else {
    const list = http.get(`${BASE_URL}/settlements?page=1&limit=5`, {
      headers: jsonHeaders(data.token),
    });
    const items = (list.json('items') as Array<{ id: string }>) || [];
    if (items.length > 0) {
      const start = Date.now();
      const res = http.get(`${BASE_URL}/settlements/${items[0].id}`, {
        headers: jsonHeaders(data.token),
      });
      statusLatency.add(Date.now() - start);
      errorRate.add(!check(res, { 'settlement status 200': (r) => r.status === 200 }));
    }
  }
  sleep(0.1);
}
