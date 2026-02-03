// src/controllers/blockedSlots.controller.js
import {
  listBlockedSlots,
  createBlockedSlot,
  deleteBlockedSlot,
} from "../services/blockedSlots.service.js";
import { getProviderProfileIdForUser } from "../services/provider.service.js";

export async function listBlockedSlotsController(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can list blocked slots" });
    }
    const providerId = req.user.id;
    const { from, to } = req.query;
    const items = await listBlockedSlots(providerId, { from, to });
    return res.json({ data: items });
  } catch (err) {
    console.error("[BLOCKED_SLOTS] list error:", err);
    return res.status(500).json({ error: "Could not fetch blocked slots" });
  }
}

export async function createBlockedSlotController(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can block slots" });
    }
    const providerId = req.user.id;
    const { slotDate, startTime, endTime } = req.body;
    if (!slotDate) {
      return res.status(400).json({ error: "slotDate is required (YYYY-MM-DD)" });
    }
    const created = await createBlockedSlot(
      providerId,
      slotDate,
      startTime ?? null,
      endTime ?? null
    );
    return res.status(201).json(created);
  } catch (err) {
    console.error("[BLOCKED_SLOTS] create error:", err);
    return res.status(500).json({ error: "Could not create blocked slot" });
  }
}

export async function deleteBlockedSlotController(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can unblock slots" });
    }
    const providerId = req.user.id;
    const { id } = req.params;
    const deleted = await deleteBlockedSlot(id, providerId);
    if (!deleted) {
      return res.status(404).json({ error: "Blocked slot not found" });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("[BLOCKED_SLOTS] delete error:", err);
    return res.status(500).json({ error: "Could not delete blocked slot" });
  }
}
