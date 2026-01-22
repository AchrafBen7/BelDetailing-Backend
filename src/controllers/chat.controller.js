import { supabaseAdmin as supabase } from "../config/supabase.js";
import {
  createOrGetConversation,
  sendMessage,
  getMessages,
  getConversations,
  markMessagesAsRead,
} from "../services/chat.service.js";

export async function listConversations(req, res) {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    // ✅ Accepter provider, customer, et company
    if (userRole !== "provider" && userRole !== "customer" && userRole !== "company") {
      return res.status(403).json({
        error: "Only providers, customers, and companies can access conversations",
      });
    }

    const conversations = await getConversations(userId, userRole);
    return res.json({ data: conversations });
  } catch (err) {
    console.error("[CHAT] listConversations error:", err);
    return res.status(500).json({ error: "Could not fetch conversations" });
  }
}

export async function getConversation(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const { data: conversation, error } = await supabase
      .from("conversations")
      .select(
        `
          *,
          provider:provider_profiles!conversations_provider_id_fkey(display_name, logo_url),
          customer:users!conversations_customer_id_fkey(id, email),
          booking:bookings(id, service_name, date, status)
        `
      )
      .eq("id", id)
      .single();

    if (error || !conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    if (userRole === "provider" && conversation.provider_id !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    // ✅ Company utilise customer_id dans la conversation (company = customer dans le contexte chat)
    if ((userRole === "customer" || userRole === "company") && conversation.customer_id !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    return res.json({ data: conversation });
  } catch (err) {
    console.error("[CHAT] getConversation error:", err);
    return res.status(500).json({ error: "Could not fetch conversation" });
  }
}

export async function createOrGetConversationController(req, res) {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { provider_id, customer_id, booking_id, application_id, offer_id } = req.body;

    // 🆕 Cas 1: Conversation pour une candidature (company ↔ detailer)
    // OU conversation pour une offre (detailer n'a pas encore postulé)
    if (application_id || (offer_id && !application_id && userRole === "provider")) {
      if (userRole !== "company" && userRole !== "provider") {
        return res.status(403).json({
          error: "Only companies and providers can create conversations for applications/offers",
        });
      }

      // Si application_id est fourni, vérifier que l'application existe
      let application = null;
      if (application_id) {
        const { data: appData, error: appError } = await supabase
          .from("applications")
          .select("provider_id, offer_id, status")
          .eq("id", application_id)
          .single();

        if (appError || !appData) {
          return res.status(404).json({ error: "Application not found" });
        }
        application = appData;
      }
      
      // Si pas d'application mais offer_id, récupérer l'offre
      let offer = null;
      if (!application && offer_id) {
        const { data: offerData, error: offerError } = await supabase
          .from("offers")
          .select("created_by, status")
          .eq("id", offer_id)
          .single();

        if (offerError || !offerData) {
          return res.status(404).json({ error: "Offer not found" });
        }
        
        // Vérifier que l'offre est ouverte
        if (offerData.status !== "open") {
          return res.status(400).json({
            error: "Cannot start a conversation for a closed offer",
          });
        }
        offer = offerData;
      } else if (application) {
        // Récupérer l'offre depuis l'application
        const { data: offerData, error: offerError } = await supabase
          .from("offers")
          .select("created_by, status")
          .eq("id", application.offer_id)
          .single();

        if (offerError || !offerData) {
          return res.status(404).json({ error: "Offer not found" });
        }
        offer = offerData;
      }

      // Vérifier les permissions
      if (userRole === "company") {
        // La company doit être le créateur de l'offre
        if (!offer || offer.created_by !== userId) {
          return res.status(403).json({
            error: "You are not the creator of this offer",
          });
        }

        // Si application_id est fourni, vérifier que le provider est celui de l'application
        if (application && application.provider_id) {
          // Créer la conversation: provider = detailer, customer = company
          const conversation = await createOrGetConversation({
            provider_id: application.provider_id,
            customer_id: userId,
            booking_id: null,
            application_id: application_id || null,
            offer_id: offer_id || application.offer_id,
          });

          return res.json({ data: conversation });
        } else {
          // Pas d'application, mais offer_id fourni - créer une conversation générique
          // (normalement ce cas ne devrait pas arriver pour une company)
          return res.status(400).json({
            error: "Application ID is required for company conversations",
          });
        }
      } else if (userRole === "provider") {
        // Si application_id est fourni, vérifier que le provider est celui de l'application
        if (application && application.provider_id !== userId) {
          return res.status(403).json({
            error: "You are not the provider of this application",
          });
        }

        // Créer la conversation: provider = detailer (userId), customer = company
        const conversation = await createOrGetConversation({
          provider_id: userId,
          customer_id: offer.created_by,
          booking_id: null,
          application_id: application_id || null,
          offer_id: offer_id || (application ? application.offer_id : null),
        });

        return res.json({ data: conversation });
      }
    }

    // Cas 2: Conversation pour un booking (comportement existant)
    if (userRole === "provider") {
      if (!customer_id || !booking_id) {
        return res
          .status(400)
          .json({ error: "Missing customer_id or booking_id" });
      }

      const { data: booking, error: bookingError } = await supabase
        .from("bookings")
        .select("provider_id, customer_id, status")
        .eq("id", booking_id)
        .single();

      if (bookingError || !booking) {
        return res.status(404).json({ error: "Booking not found" });
      }

      if (booking.provider_id !== userId) {
        return res.status(403).json({
          error: "You are not the provider of this booking",
        });
      }

      if (booking.customer_id !== customer_id) {
        return res.status(400).json({
          error: "Customer ID does not match booking",
        });
      }

      const allowedStatuses = [
        "confirmed",
        "started",
        "in_progress",
        "completed",
      ];
      if (!allowedStatuses.includes(booking.status)) {
        return res.status(400).json({
          error: "Booking must be confirmed to start a conversation",
        });
      }
    } else if (userRole === "customer") {
      if (!provider_id || !booking_id) {
        return res
          .status(400)
          .json({ error: "Missing provider_id or booking_id" });
      }

      const { data: booking, error: bookingError } = await supabase
        .from("bookings")
        .select("provider_id, customer_id, status")
        .eq("id", booking_id)
        .single();

      if (bookingError || !booking) {
        return res.status(404).json({ error: "Booking not found" });
      }

      if (booking.customer_id !== userId) {
        return res.status(403).json({
          error: "You are not the customer of this booking",
        });
      }

      if (booking.provider_id !== provider_id) {
        return res.status(400).json({
          error: "Provider ID does not match booking",
        });
      }

      const allowedStatuses = [
        "confirmed",
        "started",
        "in_progress",
        "completed",
      ];
      if (!allowedStatuses.includes(booking.status)) {
        return res.status(400).json({
          error: "Booking must be confirmed to start a conversation",
        });
      }
    } else {
      return res.status(403).json({
        error: "Only providers and customers can create conversations",
      });
    }

    const conversation = await createOrGetConversation({
      provider_id: userRole === "provider" ? userId : provider_id,
      customer_id: userRole === "customer" ? userId : customer_id,
      booking_id,
    });

    return res.json({ data: conversation });
  } catch (err) {
    console.error("[CHAT] createOrGetConversation error:", err);
    return res.status(500).json({ error: "Could not create conversation" });
  }
}

export async function getConversationMessages(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const rawLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(rawLimit) ? rawLimit : 50;
    const maxLimit = 100;
    const safeLimit = Math.min(limit, maxLimit);

    const { data: conversation, error: convError } = await supabase
      .from("conversations")
      .select("provider_id, customer_id")
      .eq("id", id)
      .single();

    if (convError || !conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    if (userRole === "provider" && conversation.provider_id !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    // ✅ Company utilise customer_id dans la conversation (company = customer dans le contexte chat)
    if ((userRole === "customer" || userRole === "company") && conversation.customer_id !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const messages = await getMessages(id, safeLimit);
    return res.json({
      data: messages,
      limit: safeLimit,
      hasMore: messages.length === safeLimit,
    });
  } catch (err) {
    console.error("[CHAT] getMessages error:", err);
    return res.status(500).json({ error: "Could not fetch messages" });
  }
}

export async function sendMessageController(req, res) {
  console.log("🔄 [CHAT CONTROLLER] sendMessageController called");
  console.log("📋 [CHAT CONTROLLER] Request:", {
    conversationId: req.params.id,
    userId: req.user.id,
    userRole: req.user.role,
    contentLength: req.body.content?.length || 0,
  });
  
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
      console.warn("⚠️ [CHAT CONTROLLER] Empty message content");
      return res.status(400).json({ error: "Message content is required" });
    }

    console.log("🔄 [CHAT CONTROLLER] Fetching conversation...");
    const { data: conversation, error: convError } = await supabase
      .from("conversations")
      .select("provider_id, customer_id, booking_id")
      .eq("id", id)
      .single();

    if (convError || !conversation) {
      console.error("❌ [CHAT CONTROLLER] Conversation not found:", convError);
      return res.status(404).json({ error: "Conversation not found" });
    }

    console.log("📦 [CHAT CONTROLLER] Conversation:", {
      provider_id: conversation.provider_id,
      customer_id: conversation.customer_id,
      booking_id: conversation.booking_id,
    });

    // Vérifier les permissions selon le rôle
    if (userRole === "provider" && conversation.provider_id !== userId) {
      console.warn("⚠️ [CHAT CONTROLLER] Provider not authorized");
      return res.status(403).json({ error: "Forbidden" });
    }
    // ✅ Company utilise customer_id dans la conversation (company = customer dans le contexte chat)
    if ((userRole === "customer" || userRole === "company") && conversation.customer_id !== userId) {
      console.warn("⚠️ [CHAT CONTROLLER] Customer/Company not authorized");
      return res.status(403).json({ error: "Forbidden" });
    }

    if (conversation.booking_id) {
      const { data: booking, error: bookingError } = await supabase
        .from("bookings")
        .select("status")
        .eq("id", conversation.booking_id)
        .single();

      if (!bookingError && booking) {
        const allowedStatuses = [
          "confirmed",
          "started",
          "in_progress",
          "completed",
        ];
        if (!allowedStatuses.includes(booking.status)) {
          console.warn("⚠️ [CHAT CONTROLLER] Booking status not allowed:", booking.status);
          return res.status(400).json({
            error: "Cannot send messages for this booking status",
          });
        }
      }
    }

    console.log("🔄 [CHAT CONTROLLER] Sending message with:", {
      conversation_id: id,
      sender_id: userId,
      sender_role: userRole,
      contentLength: content.trim().length,
    });

    const message = await sendMessage({
      conversation_id: id,
      sender_id: userId,
      sender_role: userRole,
      content: content.trim(),
    });

    console.log("✅ [CHAT CONTROLLER] Message sent successfully:", message.id);
    return res.status(201).json({ data: message });
  } catch (err) {
    console.error("❌ [CHAT CONTROLLER] sendMessage error:", err);
    console.error("❌ [CHAT CONTROLLER] Error details:", {
      message: err.message,
      code: err.code,
      details: err.details,
      hint: err.hint,
      stack: err.stack,
    });
    return res.status(500).json({ 
      error: "Could not send message",
      details: err.message,
    });
  }
}

export async function markAsReadController(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const { data: conversation, error: convError } = await supabase
      .from("conversations")
      .select("provider_id, customer_id")
      .eq("id", id)
      .single();

    if (convError || !conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    if (userRole === "provider" && conversation.provider_id !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (userRole === "customer" && conversation.customer_id !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await markMessagesAsRead(id, userId);
    return res.json({ success: true });
  } catch (err) {
    console.error("[CHAT] markAsRead error:", err);
    return res.status(500).json({ error: "Could not mark messages as read" });
  }
}
