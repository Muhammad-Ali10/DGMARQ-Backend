import { getRedisClient } from "../config/redis.js";

/**
 * Redis response cache middleware.
 * Caches GET responses for the given TTL.
 * Usage: router.get("/bestsellers", cacheResponse(300), getBestSellers);
 */
export const cacheResponse = (ttlSeconds = 60) => {
  return async (req, res, next) => {
    const redis = getRedisClient();
    if (!redis || req.method !== "GET") return next();

    const key = `res:${req.originalUrl}`;

    try {
      const cached = await redis.get(key);
      if (cached) {
        const data = JSON.parse(cached);
        return res.status(200).json(data);
      }
    } catch {
      // Redis failure — proceed without cache
      return next();
    }

    // Override res.json to cache the response before sending
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        redis.setex(key, ttlSeconds, JSON.stringify(body)).catch(() => {});
      }
      return originalJson(body);
    };

    next();
  };
};

/**
 * Invalidate a cached response by URL pattern.
 * Usage: await invalidateCache('/api/v1/bestseller*');
 */
export const invalidateCache = async (pattern) => {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    const keys = await redis.keys(`res:${pattern}`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch {
    // Non-fatal
  }
};
