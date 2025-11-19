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
import platformRouter from "./routes/platform.route.js"
import deviceRouter from "./routes/device.route.js"
import regionRouter from "./routes/region.route.js"
import genreRouter from "./routes/genre.route.js"
import themeRouter from "./routes/theme.route.js"
import modeRouter from "./routes/mode.route.js"
import typeRouter from "./routes/type.route.js"
import productRouter from "./routes/product.route.js"
import cartRouter from "./routes/cart.router.js"
import wishlistRouter from "./routes/wishlist.router.js"



app.use("/api/v1/user", userRouter)
app.use("/api/v1/seller", sellerRouter)
app.use("/api/v1/category", categoryRouter)
app.use("/api/v1/subcategory", subCategoryRouter)
app.use("/api/v1/platform", platformRouter)
app.use("/api/v1/device", deviceRouter)
app.use("/api/v1/mode", modeRouter)
app.use("/api/v1/region", regionRouter)
app.use("/api/v1/genre", genreRouter)
app.use("/api/v1/theme", themeRouter)
app.use("/api/v1/type", typeRouter)
app.use("/api/v1/product", productRouter)
app.use("/api/v1/cart", cartRouter)
app.use("/api/v1/wishlist", wishlistRouter)


app.use(errorHandler)
 
export { app }