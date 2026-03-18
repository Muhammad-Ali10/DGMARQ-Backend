import 'dotenv/config';
import { validateEnv } from './config/env.js';
import ConnectDB from "./db/index.js";
import { app } from "./app.js";
import { initializeSocketIO } from "./socket/socket.io.js";
import { scheduleDailyPayouts } from "./jobs/payout.job.js";
import { scheduleRuntimeRefresh, refreshRuntime } from "./jobs/runtimeRefresh.job.js";
import { logger } from "./utils/logger.js";
import http from 'http';

;(async () => {
    try {
        validateEnv();
        await ConnectDB();

        app.on("error", (error) => {
            logger.error("App error", error);
            throw error
        })

        const PORT = process.env.PORT || 8000

        const server = http.createServer(app);

        const io = initializeSocketIO(server);
        app.set('io', io);

        if (process.env.REDIS_URL) {
          scheduleDailyPayouts();
          scheduleRuntimeRefresh();
          await refreshRuntime();
          const { emailWorker } = await import('./jobs/email.job.js');
          if (emailWorker) {
            logger.info('Email worker initialized');
          }
          logger.info('Background jobs scheduled');
        } else {
          logger.warn('Redis not configured - background jobs disabled');
          logger.info('Emails will be sent directly (synchronously) without queue');
        }

        server.listen(PORT, () => {
            logger.info(`Server is running at port ${PORT}`);
            logger.info(`Socket.IO server initialized`);

            // Signal PM2 that the app is ready (cluster mode)
            if (process.send) {
              process.send('ready');
            }
        })

        // Graceful shutdown
        const gracefulShutdown = (signal) => {
          logger.info(`${signal} received. Shutting down gracefully...`);

          server.close(() => {
            logger.info('HTTP server closed');
            import('mongoose').then(({ default: mongoose }) => {
              mongoose.connection.close(false).then(() => {
                logger.info('MongoDB connection closed');
                process.exit(0);
              });
            });
          });

          // Force exit after 10 seconds
          setTimeout(() => {
            logger.error('Forced shutdown after timeout');
            process.exit(1);
          }, 10000);
        };

        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    } catch (error) {
        logger.error(`MongoDB Connection Failed`, error);
        process.exit(1);
    }
})()
