import mongoose from "mongoose";
import { logger } from "../utils/logger.js";

const ConnectDB = async () => {
    try {
        // Optimized connection options for better performance
        // Note: bufferMaxEntries and bufferCommands are deprecated in Mongoose v8+
        const connectionOptions = {
            maxPoolSize: 10, // Maximum number of connections in the pool
            minPoolSize: 5, // Minimum number of connections to maintain
            serverSelectionTimeoutMS: 5000, // How long to try selecting a server
            socketTimeoutMS: 45000, // How long a send or receive on a socket can take before timeout
            connectTimeoutMS: 10000, // How long to wait for initial connection
            // Optimize for production
            ...(process.env.NODE_ENV === 'production' && {
                retryWrites: true,
                w: 'majority',
            }),
        };

        const ConnectionInstance = await mongoose.connect(
            `${process.env.MONGO_URI}/${process.env.DB_Name}`,
            connectionOptions
        );
        
        logger.success(`MongoDB Connected - DB Host: ${ConnectionInstance.connection.host}`);
        logger.info(`Connection Pool: min=${connectionOptions.minPoolSize}, max=${connectionOptions.maxPoolSize}`);

        // Handle connection events
        mongoose.connection.on('error', (err) => {
            logger.error('MongoDB connection error:', err);
        });

        mongoose.connection.on('disconnected', () => {
            logger.warn('MongoDB disconnected');
        });

        mongoose.connection.on('reconnected', () => {
            logger.success('MongoDB reconnected');
        });

    } catch (error) {
        logger.error("DB Connection Failed", error);
        process.exit(1);
    }
};

export default ConnectDB;


