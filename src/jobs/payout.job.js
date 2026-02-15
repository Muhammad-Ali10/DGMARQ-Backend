import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { processScheduledPayouts } from '../services/payout.service.js';
import { logger } from '../utils/logger.js';

/** Creates Redis connection. Sends password only when REDIS_URL has auth (avoids localhost warning). */
const createRedisConnection = () => {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  const connectionOptions = {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    reconnectOnError: (err) => {
      const targetError = 'READONLY';
      if (err.message.includes(targetError)) {
        return true;
      }
      return false;
    },
  };

  try {
    const url = new URL(redisUrl);
    const host = url.hostname || 'localhost';
    const port = parseInt(url.port) || 6379;
    const isLocalhost = host === 'localhost' || host === '127.0.0.1';
    const hasPasswordInUrl = url.password && url.password.trim() !== '';
    const usePassword = hasPasswordInUrl && !isLocalhost;

    connectionOptions.host = host;
    connectionOptions.port = port;
    if (usePassword) {
      connectionOptions.password = url.password;
      if (url.username && url.username.trim() !== '') {
        connectionOptions.username = url.username;
      }
    }
    return new Redis(connectionOptions);
  } catch (error) {
    logger.warn('[REDIS] Failed to parse REDIS_URL, using as-is:', error.message);
    return new Redis(redisUrl, {
      maxRetriesPerRequest: null,
    });
  }
};

const connection = createRedisConnection();

connection.on('error', (err) => {
  logger.error('[REDIS] Connection error:', err.message);
});

export const payoutQueue = new Queue('payout-processing', { connection });

export const payoutWorker = new Worker(
  'payout-processing',
  async (job) => {
    const results = await processScheduledPayouts();
    return results;
  },
  { 
    connection,
    concurrency: 1,
  }
);

payoutWorker.on('failed', (job, err) => {
  logger.error(`Payout job ${job.id} failed:`, err);
});

/** Schedules daily payout processing at midnight UTC. */
export const scheduleDailyPayouts = () => {
  payoutQueue.add(
    'process-scheduled-payouts',
    {},
    {
      repeat: {
        pattern: '0 0 * * *',
      },
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    }
  );
};

/** Triggers immediate payout processing. */
export const processPayoutsNow = async () => {
  const job = await payoutQueue.add('process-scheduled-payouts', {}, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  });
  return job;
};

export { connection };

