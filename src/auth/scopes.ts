export type ApiScope =
  | 'payments:read'
  | 'payments:write'
  | 'settlements:read'
  | 'webhooks:manage'
  | 'merchant:manage';

/**
 * Scopes that may be assigned to a merchant API key.
 *
 * `merchant:manage` is deliberately excluded: account-management operations
 * (updating bank/settlement details, minting new API keys) must never be
 * reachable with an API key — only with an interactive JWT session. Routes
 * guarded by `@Scopes('merchant:manage')` are therefore unreachable for any
 * API-key-authenticated caller, which prevents a leaked/narrow key from
 * self-escalating.
 */
export const API_KEY_SCOPES: ApiScope[] = [
  'payments:read',
  'payments:write',
  'settlements:read',
  'webhooks:manage',
];
