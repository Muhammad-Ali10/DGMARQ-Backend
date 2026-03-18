import express from "express";
import {
  getBestsellers,
  getBestsellerByProduct,
  triggerBestSellerGeneration,
} from "../controller/bestseller.controller.js";
import { verifyJWT } from "../middlerwares/authmiddlerware.js";
import { authorizeRoles } from "../middlerwares/authmiddlerware.js";

const router = express.Router();

router.get("/", getBestsellers);
router.get("/product/:productId", getBestsellerByProduct);

router.post(
  "/generate",
  verifyJWT,
  authorizeRoles("admin"),
  triggerBestSellerGeneration
);

export default router;

