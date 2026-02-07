// Purpose: Device routes for creating, updating, toggling status, and deleting device entries
import { Router } from "express";
import { createDevice, updateDevice, getDevices, getDeviceById, deleteDevice, toggleDeviceStatus } from "../controller/device.controller.js";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";

const router = Router();

router.route("/create-device").post(verifyJWT, authorizeRoles("admin"), createDevice);
router.route("/update-device/:id").patch(verifyJWT, authorizeRoles("admin"), updateDevice);
router.route("/toggle-device-status/:id").post(verifyJWT, authorizeRoles("admin"), toggleDeviceStatus); 
router.route("/delete-device/:id").delete(verifyJWT, authorizeRoles("admin"), deleteDevice);
router.route("/get-devices").get(getDevices);

export default router;