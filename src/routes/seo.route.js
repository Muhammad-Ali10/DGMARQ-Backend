import { Router } from "express";
import { getHomePageSEO } from "../controller/seo.controller.js";
import { apiRateLimiter } from "../middlerwares/rateLimit.middlerware.js";

const router = Router();

// Apply rate limiting
router.use(apiRateLimiter);

// Public route to get home page SEO
router.get("/home", getHomePageSEO);

export default router;
