import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  listConversations,
  getConversation,
  createOrGetConversationController,
  getConversationMessages,
  sendMessageController,
  markAsReadController,
} from "../controllers/chat.controller.js";

const router = Router();

router.use(requireAuth);

router.get("/conversations", listConversations);
router.post("/conversations", createOrGetConversationController);
router.get("/conversations/:id", getConversation);
router.get("/conversations/:id/messages", getConversationMessages);
router.post("/conversations/:id/messages", sendMessageController);
router.post("/conversations/:id/read", markAsReadController);

export default router;
