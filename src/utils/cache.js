// Purpose: Simple in-memory cache with TTL support
class SimpleCache {
  constructor() {
    this.cache = new Map();
  }

  // Purpose: Stores a value with optional TTL expiration
  set(key, value, ttlMs = 300000) {
    const expiresAt = Date.now() + ttlMs;
    this.cache.set(key, { value, expiresAt });
  }

  // Purpose: Retrieves a value if not expired
  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    return item.value;
  }

  // Purpose: Removes a key from cache
  delete(key) {
    this.cache.delete(key);
  }

  // Purpose: Clears all cache entries
  clear() {
    this.cache.clear();
  }

  // Purpose: Removes all expired cache entries
  cleanup() {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
}

const cache = new SimpleCache();

setInterval(() => {
  cache.cleanup();
}, 5 * 60 * 1000);

export default cache;
