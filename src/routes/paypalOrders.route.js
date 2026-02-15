import { Router } from "express";
import { optionalJWT } from "../middlerwares/authmiddlerware.js";
import { apiRateLimiter } from "../middlerwares/rateLimit.middlerware.js";
import { createOrder, captureOrder } from "../controller/paypalOrders.controller.js";


const router = Router();

router.use(apiRateLimiter);

router.post("/orders", optionalJWT, createOrder);

router.post("/orders/:orderId/capture", optionalJWT, captureOrder);

export default router;

