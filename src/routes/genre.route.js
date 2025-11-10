import { Router } from "express";
import {
  createGenre,
  updateGenre,
  getGenres,
  deleteGenre,
} from "../controller/genre.controller.js";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";

const router = Router();
router
  .route("/create-genre")
  .post(verifyJWT, authorizeRoles("admin"), createGenre);
router
  .route("/update-genre/:genreId")
  .patch(verifyJWT, authorizeRoles("admin"), updateGenre);
router
  .route("/delete-genre/:genreId")
  .delete(verifyJWT, authorizeRoles("admin"), deleteGenre);
router.route("/get-genres").get(getGenres);

export default router;

