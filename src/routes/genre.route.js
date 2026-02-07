import { Router } from "express";
import {
  createGenre,
  updateGenre,
  getAllGenre,
  deleteGenre,
} from "../controller/genre.controller.js";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";

// Purpose: Genre CRUD routes for admin management and public listing

const router = Router();
router
  .route("/create-genre")
  .post(verifyJWT, authorizeRoles("admin"), createGenre);
router
  .route("/update-genre/:id")
  .patch(verifyJWT, authorizeRoles("admin"), updateGenre);
router
  .route("/delete-genre/:id")
  .delete(verifyJWT, authorizeRoles("admin"), deleteGenre);
router.route("/get-genres").get(getAllGenre);

export default router;

