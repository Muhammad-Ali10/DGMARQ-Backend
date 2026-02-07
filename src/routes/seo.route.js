import { Router } from "express";
import { getHomePageSEO } from "../controller/seo.controller.js";
import { apiRateLimiter } from "../middlerwares/rateLimit.middlerware.js";

// Purpose: SEO metadata retrieval routes for pages

const router = Router();

router.use(apiRateLimiter);

router.get("/home", getHomePageSEO);

export default router;
