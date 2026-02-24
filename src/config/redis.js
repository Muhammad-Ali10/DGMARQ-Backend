import Redis from "ioredis";
import { logger } from "../utils/logger.js";

const REDIS_DEFAULT_URL = "redis://localhost:6379";
let sharedRedisClient = null;

const parseRedisConfig = (redisUrl) => {
  const connectionOptions = {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 50, 2000),
    reconnectOnError: (err) => err.message.includes("READONLY"),
  };

  try {
    const url = new URL(redisUrl);
    const host = url.hostname || "localhost";
    const port = Number.parseInt(url.port || "6379", 10);
    const isLocalhost = host === "localhost" || host === "127.0.0.1";
    const hasPassword = Boolean(url.password && url.password.trim());

    connectionOptions.host = host;
    connectionOptions.port = Number.isNaN(port) ? 6379 : port;

    if (hasPassword && !isLocalhost) {
      connectionOptions.password = url.password;
      if (url.username && url.username.trim()) {
        connectionOptions.username = url.username;
      }
    }

    return { urlMode: false, options: connectionOptions };
  } catch {
    return { urlMode: true, options: redisUrl };
  }
};

export const isRedisEnabled = () => Boolean(process.env.REDIS_URL);

export const createRedisConnection = () => {
  const redisUrl = process.env.REDIS_URL || REDIS_DEFAULT_URL;
  const parsed = parseRedisConfig(redisUrl);

  if (parsed.urlMode) {
    return new Redis(parsed.options, { maxRetriesPerRequest: null });
  }

  return new Redis(parsed.options);
};

export const getRedisClient = () => {
  if (sharedRedisClient) {
    return sharedRedisClient;
  }

  if (!isRedisEnabled()) {
    return null;
  }

  sharedRedisClient = createRedisConnection();
  sharedRedisClient.on("error", (err) => {
    logger.error("[REDIS] Connection error", err);
  });

  return sharedRedisClient;
};

