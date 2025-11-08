import { Router } from "express";
import { createSubCategory, getSubCategoryById, updateSubCategory, updateSubCategoryImage, updateSubCategoryStatus, getSubcategories, deleteSubcategory } from "../controller/subcategory.controller.js";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";
import { upload } from "../middlerwares/multer.middlerware.js";

const router = Router()

router.route("/create-subcategory").post(verifyJWT, authorizeRoles("admin"), upload.single("image"), createSubCategory)
router.route("/update-subcategory/:subCategoryId").patch(verifyJWT, authorizeRoles("admin"), updateSubCategory)
router.route("/update-subcategory-image/:subCategoryId").patch(verifyJWT, authorizeRoles("admin"), upload.single("image"), updateSubCategoryImage)
router.route("/update-subcategory-status/:subCategoryId").post(verifyJWT, authorizeRoles("admin"), updateSubCategoryStatus)
router.route("/delete-subcategory/:subCategoryId").delete(verifyJWT, authorizeRoles("admin"), deleteSubcategory)
router.route("/get-subcategories").get(getSubcategories)
router.route("/get-subcategory/:subCategoryId").get(getSubCategoryById)


export default router