// Purpose: Category routes for creating, updating, retrieving, and deleting product categories
import { Router } from "express";
import { createCategory, getCategoryById, updateCategory, updateCategoryImage, updateCategoryStatus, getCategories, deleteCategory } from "../controller/category.controller.js";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";
import { upload } from "../middlerwares/multer.middlerware.js";

const router = Router()


router.route("/create-category").post(verifyJWT, authorizeRoles("admin"), upload.single("image"), createCategory)
router.route("/update-category/:categoryId").patch(verifyJWT, authorizeRoles("admin"), updateCategory)
router.route("/update-category-image/:categoryId").patch(verifyJWT, authorizeRoles("admin"), upload.single("image"), updateCategoryImage)
router.route("/update-category-status/:categoryId").post(verifyJWT, authorizeRoles("admin"), updateCategoryStatus)
router.route("/delete-category/:categoryId").delete(verifyJWT, authorizeRoles("admin"), deleteCategory)
router.route("/get-categories").get(getCategories)
router.route("/get-category/:categoryId").get(getCategoryById)


export default router 
 

