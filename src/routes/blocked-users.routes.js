// src/routes/blocked-users.routes.js

import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  blockUserController,
  unblockUserController,
  getBlockedUsersController
} from "../controllers/blocked-users.controller.js";

const router = Router();

// Liste des utilisateurs bloqués
router.get("/blocked", requireAuth, getBlockedUsersController);

// Bloquer un utilisateur
router.post("/:userId/block", requireAuth, blockUserController);

// Débloquer un utilisateur
router.delete("/:userId/unblock", requireAuth, unblockUserController);

export default router;
