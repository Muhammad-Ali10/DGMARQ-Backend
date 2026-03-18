/**
 * Health check endpoint for load balancers and monitoring.
 * Returns DB and Redis connectivity status.
 */
import express from 'express';
import mongoose from 'mongoose';
import { getRedisClient, isRedisEnabled } from '../config/redis.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbOk = dbState === 1;

  let redisOk = false;
  if (isRedisEnabled()) {
    try {
      const redis = getRedisClient();
      if (redis) {
        await redis.ping();
        redisOk = true;
      }
    } catch {
      redisOk = false;
    }
  } else {
    redisOk = true; // Redis not required
  }

  const allOk = dbOk && redisOk;
  const status = allOk ? 'ok' : 'degraded';
  const statusCode = dbOk ? 200 : 503; // DB is required; Redis degradation is not fatal

  const response = {
    status,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  };

  // Include details in non-production or if requested
  if (process.env.NODE_ENV !== 'production' || req.query.verbose === 'true') {
    const DB_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    response.services = {
      database: DB_STATES[dbState] || 'unknown',
      redis: isRedisEnabled() ? (redisOk ? 'connected' : 'disconnected') : 'disabled',
    };
    response.memory = {
      rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
    };
  }

  res.status(statusCode).json(response);
});

export default router;
