// Local LRU for negative JWT blacklist lookups (jti -> "known not revoked").
// shortcut: per-instance only, so a revocation made on another pod can be missed for up to 60s; upgrade to Redis pub/sub invalidation if that window is unacceptable.
export class BlacklistCache {
  private readonly entries = new Map<string, number>(); // jti -> expiry (epoch ms), insertion order = LRU order

  constructor(
    private readonly maxEntries = 1000,
    private readonly ttlMs = 60_000,
  ) {}

  isKnownClean(jti: string): boolean {
    const expiresAt = this.entries.get(jti);
    if (expiresAt === undefined) return false;
    this.entries.delete(jti);
    if (expiresAt <= Date.now()) return false;
    this.entries.set(jti, expiresAt); // refresh recency
    return true;
  }

  markClean(jti: string): void {
    this.entries.delete(jti);
    this.entries.set(jti, Date.now() + this.ttlMs);
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  invalidate(jti: string): void {
    this.entries.delete(jti);
  }
}
