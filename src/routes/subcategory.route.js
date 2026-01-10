import { Router } from "express";
import { 
    createSubCategory, 
    getSubCategoryById, 
    getSubCategoryBySlug,
    updateSubCategory, 
    updateSubCategoryImage, 
    updateSubCategoryStatus, 
    getSubcategories, 
    deleteSubcategory, 
    getSubcategoriesByCategoryId,
    getSubcategoriesByCategorySlug
} from "../controller/subcategory.controller.js";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";
import { upload } from "../middlerwares/multer.middlerware.js";

const router = Router()

// Admin-only routes
router.route("/create-subcategory").post(verifyJWT, authorizeRoles("admin"), upload.single("image"), createSubCategory)
router.route("/update-subcategory/:subCategoryId").patch(verifyJWT, authorizeRoles("admin"), updateSubCategory)
router.route("/update-subcategory-image/:subCategoryId").patch(verifyJWT, authorizeRoles("admin"), upload.single("image"), updateSubCategoryImage)
router.route("/update-subcategory-status/:subCategoryId").post(verifyJWT, authorizeRoles("admin"), updateSubCategoryStatus)
router.route("/delete-subcategory/:subCategoryId").delete(verifyJWT, authorizeRoles("admin"), deleteSubcategory)

// Public routes
router.route("/get-subcategories").get(getSubcategories)
router.route("/get-subcategory/:subCategoryId").get(getSubCategoryById)
router.route("/get-subcategory-by-slug/:categorySlug/:subcategorySlug").get(getSubCategoryBySlug)
router.route("/get-subcategories-by-category/:categoryId").get(getSubcategoriesByCategoryId)
router.route("/get-subcategories-by-category-slug/:categorySlug").get(getSubcategoriesByCategorySlug)

export default router