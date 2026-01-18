// src/services/providerMessage.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";

/**
 * Envoyer un message encadré à un provider (customer)
 * Règle : 1 seul message gratuit par customer/provider
 * @param {string} providerId - ID du provider (user_id)
 * @param {string} customerId - ID du customer
 * @param {object} payload - { vehicleType, addressZone, preferredDate, messageText }
 */
export async function sendProviderMessage(providerId, customerId, payload) {
  try {
    const { vehicleType, addressZone, preferredDate, messageText } = payload;

    // Validation : messageText max 300 caractères
    if (messageText && messageText.length > 300) {
      const err = new Error("Message text must be 300 characters or less");
      err.statusCode = 400;
      throw err;
    }

    // Validation : pas d'infos sensibles dans messageText (email, phone, URL)
    const sensitivePatterns = [
      /@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, // Email
      /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, // Phone
      /https?:\/\/[^\s]+/g, // URL
      /(instagram|facebook|twitter|linkedin|tiktok|snapchat)/gi, // Réseaux sociaux
    ];

    const hasSensitiveInfo = sensitivePatterns.some((pattern) =>
      pattern.test(messageText || "")
    );

    if (hasSensitiveInfo) {
      const err = new Error(
        "Message cannot contain email, phone, URL, or social media information"
      );
      err.statusCode = 400;
      throw err;
    }

    // Vérifier si customer a déjà envoyé un message à ce provider
    const { data: existing, error: checkError } = await supabase
      .from("provider_messages")
      .select("id, status")
      .eq("provider_id", providerId)
      .eq("customer_id", customerId)
      .maybeSingle();

    if (checkError && checkError.code !== "PGRST116") {
      throw checkError;
    }

    // Si message existe déjà
    if (existing) {
      // Si message est "closed" ou "converted_to_booking", on peut permettre un nouveau message
      if (existing.status === "closed" || existing.status === "converted_to_booking") {
        // Autoriser nouveau message (nouveau cycle)
      } else {
        const err = new Error(
          "You have already sent a message to this provider. Please wait for a response or complete a booking to send another message."
        );
        err.statusCode = 400;
        throw err;
      }
    }

    // Créer le message
    const { data, error } = await supabase
      .from("provider_messages")
      .insert({
        provider_id: providerId,
        customer_id: customerId,
        vehicle_type: vehicleType || null,
        address_zone: addressZone || null, // Zone approximative, pas adresse exacte
        preferred_date: preferredDate || null,
        message_text: messageText || null,
        status: "pending",
      })
      .select()
      .single();

    if (error) throw error;

    return data;
  } catch (err) {
    console.error("[PROVIDER_MESSAGE] sendProviderMessage error:", err);
    throw err;
  }
}

/**
 * Répondre à un message (provider)
 * Règle : 1 seule réponse gratuite par message
 * @param {string} messageId - ID du message
 * @param {string} providerId - ID du provider (user_id)
 * @param {string} replyText - Réponse du provider
 */
export async function replyToProviderMessage(messageId, providerId, replyText) {
  try {
    // Vérifier que le message existe et appartient au provider
    const { data: message, error: fetchError } = await supabase
      .from("provider_messages")
      .select("*")
      .eq("id", messageId)
      .eq("provider_id", providerId)
      .single();

    if (fetchError || !message) {
      const err = new Error("Message not found or forbidden");
      err.statusCode = 404;
      throw err;
    }

    // Vérifier que le provider n'a pas déjà répondu
    if (message.status === "replied" || message.provider_reply) {
      const err = new Error(
        "You have already replied to this message. To continue the conversation, the customer must complete a booking."
      );
      err.statusCode = 400;
      throw err;
    }

    // Validation : replyText max 500 caractères
    if (replyText && replyText.length > 500) {
      const err = new Error("Reply text must be 500 characters or less");
      err.statusCode = 400;
      throw err;
    }

    // Validation : pas d'infos sensibles
    const sensitivePatterns = [
      /@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
      /https?:\/\/[^\s]+/g,
      /(instagram|facebook|twitter|linkedin|tiktok|snapchat)/gi,
    ];

    const hasSensitiveInfo = sensitivePatterns.some((pattern) =>
      pattern.test(replyText || "")
    );

    if (hasSensitiveInfo) {
      const err = new Error(
        "Reply cannot contain email, phone, URL, or social media information"
      );
      err.statusCode = 400;
      throw err;
    }

    // Mettre à jour le message avec la réponse
    const { data, error } = await supabase
      .from("provider_messages")
      .update({
        provider_reply: replyText,
        provider_replied_at: new Date().toISOString(),
        status: "replied",
        updated_at: new Date().toISOString(),
      })
      .eq("id", messageId)
      .select()
      .single();

    if (error) throw error;

    return data;
  } catch (err) {
    console.error("[PROVIDER_MESSAGE] replyToProviderMessage error:", err);
    throw err;
  }
}

/**
 * Lister les messages reçus par un provider
 * @param {string} providerId - ID du provider (user_id)
 * @param {string} status - Filtrer par statut ('pending' | 'replied' | 'closed')
 */
export async function getProviderMessages(providerId, status = null) {
  try {
    let query = supabase
      .from("provider_messages")
      .select("*")
      .eq("provider_id", providerId)
      .order("created_at", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error) throw error;

    return data || [];
  } catch (err) {
    console.error("[PROVIDER_MESSAGE] getProviderMessages error:", err);
    throw err;
  }
}

/**
 * Compter les messages non lus pour un provider
 * @param {string} providerId - ID du provider (user_id)
 */
export async function getUnreadMessagesCount(providerId) {
  try {
    const { count, error } = await supabase
      .from("provider_messages")
      .select("id", { count: "exact", head: true })
      .eq("provider_id", providerId)
      .eq("status", "pending");

    if (error) throw error;

    return count || 0;
  } catch (err) {
    console.error("[PROVIDER_MESSAGE] getUnreadMessagesCount error:", err);
    throw err;
  }
}

/**
 * Marquer un message comme lu/fermé
 * @param {string} messageId - ID du message
 * @param {string} providerId - ID du provider (user_id)
 * @param {string} newStatus - 'closed' | 'converted_to_booking'
 */
export async function updateMessageStatus(messageId, providerId, newStatus) {
  try {
    // Vérifier ownership
    const { data: message, error: fetchError } = await supabase
      .from("provider_messages")
      .select("provider_id")
      .eq("id", messageId)
      .eq("provider_id", providerId)
      .single();

    if (fetchError || !message) {
      const err = new Error("Message not found or forbidden");
      err.statusCode = 404;
      throw err;
    }

    const { data, error } = await supabase
      .from("provider_messages")
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", messageId)
      .select()
      .single();

    if (error) throw error;

    return data;
  } catch (err) {
    console.error("[PROVIDER_MESSAGE] updateMessageStatus error:", err);
    throw err;
  }
}
