# Merchant API examples

Each example creates a payment, polls its status until it reaches a final state, and verifies an incoming webhook signature.

| Example | Run |
| ------- | --- |
| [Node.js](node/merchant-flow.js) (Node 18+, no dependencies) | `DUPDUB_API_KEY=... node docs/examples/node/merchant-flow.js` |
| [Python](python/merchant_flow.py) (Python 3.9+, standard library only) | `DUPDUB_API_KEY=... python3 docs/examples/python/merchant_flow.py` |
| [Postman collection](../dupdub-merchant-api.postman_collection.json) | Import into Postman, then set `baseUrl` and `apiKey` |

Set `DUPDUB_BASE_URL` to change the default (`http://localhost:3000/api/v1`).

## Webhook signature

Every webhook carries `x-webhook-signature`, the hex HMAC-SHA256 of the raw request body computed with your webhook secret. Compute it over the raw bytes, before JSON parsing, and compare in constant time.
