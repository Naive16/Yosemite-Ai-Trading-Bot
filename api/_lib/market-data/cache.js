export class MarketDataCache {
  constructor(maxEntries = 64) {
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  get(key, maxAgeMs) {
    const entry = this.entries.get(key);
    if (!entry || Date.now() - entry.createdAt > maxAgeMs) {
      if (entry) this.entries.delete(key);
      return null;
    }
    return { value: entry.value, ageMs: Date.now() - entry.createdAt };
  }

  set(key, value) {
    this.entries.delete(key);
    this.entries.set(key, { value, createdAt: Date.now() });
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
  }

  clear() { this.entries.clear(); }
}
