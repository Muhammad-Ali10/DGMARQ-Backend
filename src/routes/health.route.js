/**
 * Health check endpoint for load balancers and monitoring.
 * Does not expose internal details.
 */
import express from 'express';
import mongoose from 'mongoose';

const router = express.Router();

router.get('/', (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbOk = dbState === 1;

  const status = dbOk ? 'ok' : 'degraded';
  const statusCode = dbOk ? 200 : 503;

  res.status(statusCode).json({
    status,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    ...(process.env.NODE_ENV === 'development' && {
      db: dbState === 1 ? 'connected' : ['disconnected', 'connected', 'connecting', 'disconnecting'][dbState],
    }),
  });
});

export default router;
