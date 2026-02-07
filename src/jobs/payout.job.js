import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { processScheduledPayouts } from '../services/payout.service.js';
import { logger } from '../utils/logger.js';

// Purpose: Creates Redis connection with proper password handling.
// Only sends password when REDIS_URL includes authentication (avoids warning when server has no auth).
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

    // Don't send password for localhost – avoids "password was supplied" warning when local Redis has no auth
    const usePassword = hasPasswordInUrl && !isLocalhost;

    connectionOptions.host = host;
    connectionOptions.port = port;
    if (usePassword) {
      connectionOptions.password = url.password;
      if (url.username && url.username.trim() !== '') {
        connectionOptions.username = url.username;
      }
      logger.info('[REDIS] Connecting with credentials from REDIS_URL');
    } else {
      logger.info(`[REDIS] Connecting without password: ${host}:${port}`);
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

connection.on('connect', () => {
  logger.info('[REDIS] Connected successfully');
});

connection.on('error', (err) => {
  logger.error('[REDIS] Connection error:', err.message);
});

connection.on('ready', () => {
  logger.info('[REDIS] Ready to accept commands');
});

export const payoutQueue = new Queue('payout-processing', { connection });

export const payoutWorker = new Worker(
  'payout-processing',
  async (job) => {
    logger.info(`Processing payout job: ${job.id}`);
    const results = await processScheduledPayouts();
    return results;
  },
  { 
    connection,
    concurrency: 1,
  }
);

payoutWorker.on('completed', (job) => {
  logger.info(`Payout job ${job.id} completed`);
});

payoutWorker.on('failed', (job, err) => {
  logger.error(`Payout job ${job.id} failed:`, err);
});

// Purpose: Schedules daily payout processing at midnight UTC
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
  logger.info('Daily payout processing scheduled');
};

// Purpose: Triggers immediate payout processing for testing or manual runs
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

