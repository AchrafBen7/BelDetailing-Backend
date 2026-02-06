import { Router } from "express";
import multer from "multer";
import { uploadMedia, deleteMedia } from "../controllers/media.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = Router();

// 🛡️ SÉCURITÉ : Configuration sécurisée de multer
// - Limite de taille : 10MB (évite DoS mémoire)
// - Filtre MIME : seulement images/vidéos/PDF (évite upload malware)
const allowedMimeTypes = [
  // Images
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  // Vidéos
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/webm",
  // Documents (pour factures/contrats)
  "application/pdf",
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: (req, file, cb) => {
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Type de fichier non autorisé: ${file.mimetype}. Types acceptés: ${allowedMimeTypes.join(", ")}`));
    }
  },
});

// 🛡️ SÉCURITÉ : Authentification obligatoire pour upload/delete
router.post("/upload", requireAuth, upload.single("file"), uploadMedia);
router.delete("/:id", requireAuth, deleteMedia);

export default router;
