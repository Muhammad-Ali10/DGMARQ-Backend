import mongoose from "mongoose";
import { logger } from "../utils/logger.js";

const ConnectDB = async () => {

    try {
        const ConnectionInstance = await mongoose.connect(`${process.env.MONGO_URI}/${process.env.DB_Name}`)
        logger.success(`MongoDB Connected - DB Host: ${ConnectionInstance.connection.host}`)

    } catch (error) {
        logger.error("DB Connection Failed", error);
        process.exit(1)
    }
}

export default ConnectDB;


