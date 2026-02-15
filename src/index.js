import 'dotenv/config';
import { validateEnv } from './config/env.js';
import ConnectDB from "./db/index.js";
import { app } from "./app.js";
import { initializeSocketIO } from "./socket/socket.io.js";
import { scheduleDailyPayouts } from "./jobs/payout.job.js";
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
          const { emailWorker } = await import('./jobs/email.job.js');
          if (emailWorker) {
            logger.success('Email worker initialized');
          }
          logger.success('Background jobs scheduled');
        } else {
          logger.warn('Redis not configured - background jobs disabled');
          logger.info('Emails will be sent directly (synchronously) without queue');
        }
        
        server.listen(PORT, () => {
            logger.success(`Server is running at port ${PORT}`);
            logger.info(`Socket.IO server initialized`);
        })
    } catch (error) {
        logger.error(`MongoDB Connection Failed`, error);
        process.exit(1);
    }
})()
