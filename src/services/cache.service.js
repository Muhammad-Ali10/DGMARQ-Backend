import { getRedisClient } from "../config/redis.js";

class CacheService {
  constructor() {
    this.localCache = new Map();
  }

  normalizeTtlMs(ttlMs) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      return 300000;
    }
    return ttlMs;
  }

  getLocal(key) {
    const item = this.localCache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.localCache.delete(key);
      return null;
    }
    return item.value;
  }

  setLocal(key, value, ttlMs) {
    this.localCache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  async get(key) {
    const redisClient = getRedisClient();
    if (redisClient) {
      try {
        const cached = await redisClient.get(key);
        if (!cached) return null;
        return JSON.parse(cached);
      } catch {
        return this.getLocal(key);
      }
    }

    return this.getLocal(key);
  }

  async set(key, value, ttlMs = 300000) {
    const normalizedTtlMs = this.normalizeTtlMs(ttlMs);
    const redisClient = getRedisClient();

    if (redisClient) {
      try {
        await redisClient.set(
          key,
          JSON.stringify(value),
          "PX",
          normalizedTtlMs
        );
        return;
      } catch {
        this.setLocal(key, value, normalizedTtlMs);
        return;
      }
    }

    this.setLocal(key, value, normalizedTtlMs);
  }

  async delete(key) {
    const redisClient = getRedisClient();
    if (redisClient) {
      try {
        await redisClient.del(key);
      } catch {
        this.localCache.delete(key);
      }
      return;
    }

    this.localCache.delete(key);
  }

  async clear() {
    const redisClient = getRedisClient();
    if (redisClient) {
      try {
        await redisClient.flushdb();
      } catch {
        this.localCache.clear();
      }
      return;
    }

    this.localCache.clear();
  }
}

const cacheService = new CacheService();
export default cacheService;

