# Payment metadata

Payment metadata is an optional JSON object for merchant-defined values such as `orderId`, `customerId`, or an internal reconciliation key. Keep values small (the payment API caps metadata at 4 KiB), avoid secrets and personal data, and use stable, consistently named keys with scalar values when they need to be searched.

Filter a merchant's payments by an exact metadata key and value with bracket query syntax:

```http
GET /payments?metadata[orderId]=123
```

The filter is merchant-scoped and compares the JSON value as text. Multiple metadata filters can be supplied and are combined with AND. PostgreSQL uses a GIN index for metadata containment workloads; reference and Stellar memo filters use exact matches.
