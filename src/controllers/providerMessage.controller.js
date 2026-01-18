// src/controllers/providerMessage.controller.js
import {
  sendProviderMessage,
  replyToProviderMessage,
  getProviderMessages,
  getUnreadMessagesCount,
  updateMessageStatus,
} from "../services/providerMessage.service.js";

/**
 * POST /api/v1/providers/:id/message
 * Envoyer un message encadré à un provider (customer uniquement)
 */
export async function sendMessage(req, res) {
  try {
    if (req.user.role !== "customer") {
      return res.status(403).json({ error: "Only customers can send messages" });
    }

    const { id: providerId } = req.params;
    const customerId = req.user.id;
    const { vehicleType, addressZone, preferredDate, messageText } = req.body;

    const message = await sendProviderMessage(providerId, customerId, {
      vehicleType,
      addressZone,
      preferredDate,
      messageText,
    });

    return res.status(201).json({ data: message });
  } catch (err) {
    console.error("[PROVIDER_MESSAGE] sendMessage error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || "Could not send message" });
  }
}

/**
 * POST /api/v1/providers/messages/:id/reply
 * Répondre à un message (provider uniquement)
 */
export async function replyMessage(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can reply to messages" });
    }

    const { id: messageId } = req.params;
    const providerId = req.user.id;
    const { replyText } = req.body;

    if (!replyText || replyText.trim().length === 0) {
      return res.status(400).json({ error: "Reply text is required" });
    }

    const message = await replyToProviderMessage(messageId, providerId, replyText);

    return res.json({ data: message });
  } catch (err) {
    console.error("[PROVIDER_MESSAGE] replyMessage error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || "Could not reply to message" });
  }
}

/**
 * GET /api/v1/providers/me/messages
 * Lister les messages reçus par un provider (provider uniquement)
 */
export async function listMessages(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can view messages" });
    }

    const providerId = req.user.id;
    const { status } = req.query; // 'pending' | 'replied' | 'closed'

    const messages = await getProviderMessages(providerId, status || null);

    return res.json({ data: messages });
  } catch (err) {
    console.error("[PROVIDER_MESSAGE] listMessages error:", err);
    return res.status(500).json({ error: "Could not fetch messages" });
  }
}

/**
 * GET /api/v1/providers/me/messages/unread-count
 * Compter les messages non lus pour un provider (provider uniquement)
 */
export async function getUnreadCount(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can view unread count" });
    }

    const providerId = req.user.id;

    const count = await getUnreadMessagesCount(providerId);

    return res.json({ count });
  } catch (err) {
    console.error("[PROVIDER_MESSAGE] getUnreadCount error:", err);
    return res.status(500).json({ error: "Could not fetch unread count" });
  }
}

/**
 * PATCH /api/v1/providers/messages/:id/status
 * Marquer un message comme lu/fermé (provider uniquement)
 */
export async function updateStatus(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can update message status" });
    }

    const { id: messageId } = req.params;
    const providerId = req.user.id;
    const { status: newStatus } = req.body; // 'closed' | 'converted_to_booking'

    if (!["closed", "converted_to_booking"].includes(newStatus)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const message = await updateMessageStatus(messageId, providerId, newStatus);

    return res.json({ data: message });
  } catch (err) {
    console.error("[PROVIDER_MESSAGE] updateStatus error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || "Could not update message status" });
  }
}
