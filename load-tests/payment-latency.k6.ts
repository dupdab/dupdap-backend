import http from "k6/http";
import { check, fail, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

const creation = new Trend("payment_creation_ms", true);
const confirmation = new Trend("payment_confirmation_ms", true);
const dispatch = new Trend("settlement_dispatch_ms", true);
const failures = new Rate("lifecycle_failures");
export const options = {
  vus: Number(__ENV.VUS || 1),
  iterations: Number(__ENV.ITERATIONS || 20),
  summaryTrendStats: ["med", "p(95)", "p(99)", "min", "max"],
  thresholds: {
    payment_creation_ms: ["p(95)<200"],
    payment_confirmation_ms: ["p(95)<5000"],
    lifecycle_failures: ["rate==0"],
    checks: ["rate==1"],
  },
};
const base = __ENV.BASE_URL || "http://localhost:3000/api/v1";

export function setup() {
  if (!__ENV.TOKEN || !__ENV.CONFIRMATION_DRIVER_URL) {
    fail(
      "Set TOKEN and CONFIRMATION_DRIVER_URL (a testnet funding driver; never production).",
    );
  }
}

export default function () {
  const headers = {
    Authorization: `Bearer ${__ENV.TOKEN}`,
    "Content-Type": "application/json",
  };
  const created = http.post(
    `${base}/payments`,
    JSON.stringify({ amountUsd: 20 }),
    { headers },
  );
  creation.add(created.timings.duration);
  if (!check(created, { "payment created": (r) => r.status === 201 })) {
    failures.add(true);
    return;
  }
  const payment = created.json() as any;
  // The application has no merchant confirmation endpoint. A supplied testnet
  // driver submits a real deposit using the generated address and memo.
  const started = Date.now();
  const funded = http.post(
    __ENV.CONFIRMATION_DRIVER_URL,
    JSON.stringify(payment),
    {
      headers: { "Content-Type": "application/json" },
      timeout: "10s",
    },
  );
  if (
    !check(funded, {
      "test deposit submitted": (r) => r.status >= 200 && r.status < 300,
    })
  ) {
    failures.add(true);
    return;
  }
  let confirmedAt: number | undefined;
  const timeout = Number(__ENV.TIMEOUT_MS || 30000);
  while (Date.now() - started < timeout) {
    const result = http.get(`${base}/payments/${payment.id}`, { headers });
    if (result.status !== 200) {
      failures.add(true);
      return;
    }
    const state = result.json() as any;
    if (
      ["confirmed", "settling", "settled"].includes(state.status) &&
      confirmedAt === undefined
    ) {
      confirmedAt = Date.now();
      confirmation.add(confirmedAt - started);
    }
    if (state.settlementId) {
      // settlementId is persisted before enqueue; this measures observable
      // settlement initiation, not partner-bank completion or queue execution.
      dispatch.add(Date.now() - (confirmedAt || started));
      failures.add(false);
      return;
    }
    if (["failed", "expired"].includes(state.status)) break;
    sleep(0.05);
  }
  failures.add(true);
  check(false, {
    "confirmation and settlement observed before timeout": (ok) => ok,
  });
}

export function handleSummary(data: unknown) {
  return { "payment-latency-results.json": JSON.stringify(data, null, 2) };
}
