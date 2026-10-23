"""DupDub merchant flow: create payment, poll status, verify webhook.

Usage: DUPDUB_API_KEY=... python3 merchant_flow.py
"""
import hashlib
import hmac
import json
import os
import time
import urllib.request

BASE_URL = os.environ.get("DUPDUB_BASE_URL", "http://localhost:3000/api/v1")
API_KEY = os.environ.get("DUPDUB_API_KEY")
FINAL_STATUSES = {"settled", "failed", "expired", "cancelled", "refunded"}


def api(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json", "X-API-Key": API_KEY},
    )
    with urllib.request.urlopen(req) as res:
        return json.loads(res.read())


def create_payment():
    return api(
        "POST",
        "/payments",
        {"amountUsd": 25.0, "description": "Order #1001", "customerEmail": "customer@example.com"},
    )


def poll_status(payment_id, interval=5, timeout=15 * 60):
    deadline = time.time() + timeout
    while time.time() < deadline:
        payment = api("GET", f"/payments/{payment_id}")
        print(f"status={payment['status']}")
        if payment["status"] in FINAL_STATUSES:
            return payment
        time.sleep(interval)
    raise TimeoutError("Timed out waiting for payment")


def verify_webhook(raw_body: bytes, signature: str, secret: str) -> bool:
    """Verify `x-webhook-signature` against the raw request body."""
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")


# Example Flask handler:
# @app.post("/webhooks/dupdub")
# def dupdub_webhook():
#     if not verify_webhook(request.get_data(), request.headers.get("x-webhook-signature"),
#                           os.environ["DUPDUB_WEBHOOK_SECRET"]):
#         return "", 401
#     payload = request.get_json()
#     print("received", payload["event"], payload["data"])
#     return "", 200


def main():
    if not API_KEY:
        raise SystemExit("Set DUPDUB_API_KEY")
    payment = create_payment()
    print(f"created payment {payment['id']} (reference {payment.get('reference')})")
    final = poll_status(payment["id"])
    print(f"final status: {final['status']}")


if __name__ == "__main__":
    main()
