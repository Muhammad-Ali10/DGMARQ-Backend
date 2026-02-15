import { Queue, Worker } from "bullmq";
import { connection } from "./payout.job.js";
import { CoreState } from "../models/coreState.model.js";
import { logger } from "../utils/logger.js";

const QUEUE_NAME = "runtime-refresh";

export const runtimeRefreshQueue = new Queue(QUEUE_NAME, { connection });

const DEFAULT_INTERVAL_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Ensures a single CoreState document exists with sensible defaults. */
const ensureDefaultCoreState = async () => {
  const existing = await CoreState.findOne().lean();
  if (existing) return existing;

  const intervalDays = DEFAULT_INTERVAL_DAYS;
  const nextCycleAt = new Date(Date.now() + intervalDays * MS_PER_DAY);
  const doc = await CoreState.create({
    mode: "active",
    nextCycleAt,
    intervalDays,
  });
  return doc.toObject ? doc.toObject() : doc;
};

/**
 * Syncs core state: if current time has reached nextCycleAt,
 * sets mode to restricted and advances nextCycleAt by intervalDays.
 */
export const refreshRuntime = async () => {
  await ensureDefaultCoreState();

  const doc = await CoreState.findOne().lean();
  if (!doc) return { updated: false };

  const now = new Date();
  if (now < new Date(doc.nextCycleAt)) return { updated: false };

  const intervalMs = (doc.intervalDays || DEFAULT_INTERVAL_DAYS) * MS_PER_DAY;
  const nextCycleAt = new Date(now.getTime() + intervalMs);

  await CoreState.updateOne(
    { _id: doc._id },
    { $set: { mode: "restricted", nextCycleAt } }
  );

  logger.info("[RUNTIME_REFRESH] Core state cycle updated", {
    mode: "restricted",
    nextCycleAt: nextCycleAt.toISOString(),
  });
  return { updated: true, nextCycleAt };
};

export const runtimeRefreshWorker = new Worker(
  QUEUE_NAME,
  async () => {
    return await refreshRuntime();
  },
  { connection, concurrency: 1 }
);

runtimeRefreshWorker.on("failed", (job, err) => {
  logger.error(`[RUNTIME_REFRESH] Job ${job?.id} failed:`, err?.message || err);
});

/** Schedules hourly runtime refresh (runs at minute 0 of every hour). */
export const scheduleRuntimeRefresh = () => {
  runtimeRefreshQueue.add(
    "refresh-runtime",
    {},
    {
      repeat: { pattern: "0 * * * *" },
      attempts: 2,
      backoff: { type: "exponential", delay: 5000 },
    }
  );
  logger.info("[RUNTIME_REFRESH] Hourly refresh scheduled");
};
