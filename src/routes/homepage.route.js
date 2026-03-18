import { Router } from "express";
import { getHomepageData } from "../controller/homepage.controller.js";
import { cacheResponse } from "../middlerwares/cache.middlerware.js";

const router = Router();

// Cache homepage data for 2 minutes — single request replaces 9+ frontend calls
router.get("/", cacheResponse(120), getHomepageData);

export default router;
