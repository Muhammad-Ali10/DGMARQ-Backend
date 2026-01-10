// Load environment variables FIRST before any other imports
import 'dotenv/config'
import ConnectDB from "./db/index.js"
import { app } from "./app.js"
import { initializeSocketIO } from "./socket/socket.io.js"
import { scheduleDailyPayouts } from "./jobs/payout.job.js"
import { logger } from "./utils/logger.js"
import http from 'http'

;(async () => {
    try {
        await ConnectDB()

        app.on("error", (error) => {
            logger.error("App error", error);
            throw error
        })

        const PORT = process.env.PORT || 8000
        
        // Create HTTP server for Socket.IO
        const server = http.createServer(app);
        
        // Initialize Socket.IO
        const io = initializeSocketIO(server);
        app.set('io', io); // Make io available in routes if needed
        
        // Schedule background jobs
        if (process.env.REDIS_URL) {
          scheduleDailyPayouts();
          // Initialize email worker (imported automatically when email.job.js loads)
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
