import express from "express"
import cors from "cors"
import cookieParser from "cookie-parser"
import { errorHandler } from "./middlerwares/error.middlerware.js"
const app = express()


app.use(cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true

}))

app.use(express.json({
    limit: "16kb",
    strict: true,
    type: 'application/json'
}))

app.use(express.urlencoded({
    extended: true,
    limit: "16kb"
}))


app.use(cookieParser())
app.use(express.static("public"))



import userRouter from "./routes/user.route.js"
import sellerRouter from "./routes/seller.route.js"
import categoryRouter from "./routes/category.route.js"
import subCategoryRouter from "./routes/subcategory.route.js"


app.use("/api/v1/user", userRouter)
app.use("/api/v1/seller", sellerRouter)
app.use("/api/v1/category", categoryRouter)
app.use("/api/v1/subcategory", subCategoryRouter)



app.use(errorHandler)

export { app }