import ConnectDB from "./db/index.js"
import { app } from "./app.js"
import 'dotenv/config'




;(async () => {
    try {
        await ConnectDB()

        app.on("error", (error) => {
            console.error("App error:", error)
            throw error
        })

        const PORT = process.env.PORT || 8000
        app.listen(PORT, () => {
            console.log(`🚀 Server is running at port ${PORT}`)
        })
    } catch (error) {
        console.error(`❌ MongoDB Connection Failed !!! ${error.message}`)
    }
})()
