import mongoose from "mongoose";

const ConnectDB = async () => {

    try {
        const ConnectionInstance = await mongoose.connect(`${process.env.MONGO_URI}/${process.env.DB_Name}`)
        console.log(`\n Mongo DB Connected !! DB Host ${ConnectionInstance.connection.host}`)

    } catch (error) {
        console.log("DB Connection Faild", error)
        process.exit(1)
    }
}

export default ConnectDB;


