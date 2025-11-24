import { Router } from "express";
import multer from "multer";
import { uploadMedia, deleteMedia } from "../controllers/media.controller.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post("/upload", upload.single("file"), uploadMedia);

router.delete("/:id", deleteMedia);

export default router;
