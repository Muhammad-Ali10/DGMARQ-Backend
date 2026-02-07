import mongoose from "mongoose";
import { logger } from "../utils/logger.js";

// Purpose: Establish and manage MongoDB database connection with optimized settings
  const ConnectDB = async () => {
    try {
        const connectionOptions = {
            maxPoolSize: 10,
            minPoolSize: 5,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            connectTimeoutMS: 10000,
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


