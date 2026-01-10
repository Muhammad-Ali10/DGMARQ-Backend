import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { processScheduledPayouts } from '../services/payout.service.js';

// Redis connection
const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

// Create payout queue
export const payoutQueue = new Queue('payout-processing', { connection });

// Create payout worker
export const payoutWorker = new Worker(
  'payout-processing',
  async (job) => {
    console.log(`Processing payout job: ${job.id}`);
    const results = await processScheduledPayouts();
    console.log(`Payout processing completed:`, results);
    return results;
  },
  { 
    connection,
    concurrency: 1, // Process one at a time to avoid race conditions
  }
);

// Handle job events
payoutWorker.on('completed', (job) => {
  console.log(`Payout job ${job.id} completed`);
});

payoutWorker.on('failed', (job, err) => {
  console.error(`Payout job ${job.id} failed:`, err);
});

/**
 * Schedule daily payout processing (runs at midnight UTC)
 */
export const scheduleDailyPayouts = () => {
  payoutQueue.add(
    'process-scheduled-payouts',
    {},
    {
      repeat: {
        pattern: '0 0 * * *', // Daily at midnight UTC (cron format)
      },
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    }
  );
  console.log('Daily payout processing scheduled');
};

/**
 * Process payouts immediately (for testing or manual trigger)
 */
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

