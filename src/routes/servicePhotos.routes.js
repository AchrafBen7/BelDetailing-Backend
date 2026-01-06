import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  listServicePhotos,
  addServicePhotoController,
  deleteServicePhotoController,
} from "../controllers/servicePhotos.controller.js";

const router = Router();

router.get("/:id/photos", listServicePhotos);
router.post("/:id/photos", requireAuth, addServicePhotoController);
router.delete("/:id/photos/:photoId", requireAuth, deleteServicePhotoController);

export default router;
