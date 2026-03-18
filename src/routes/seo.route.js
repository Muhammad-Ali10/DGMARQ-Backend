import { Router } from "express";
import { getHomePageSEO } from "../controller/seo.controller.js";


const router = Router();

router.get("/home", getHomePageSEO);

export default router;
