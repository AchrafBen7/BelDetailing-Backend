import { supabaseAdmin as supabase } from "../config/supabase.js";

export async function createOrGetConversation({
  provider_id,
  customer_id,
  booking_id,
  application_id,
  offer_id,
}) {
  console.log(`[CHAT] createOrGetConversation called:`, {
    provider_id,
    customer_id,
    booking_id,
    application_id,
    offer_id,
  });
  
  // Construire la requête de recherche
  // ⚠️ IMPORTANT : Ne JAMAIS utiliser .single() ou .maybeSingle() ici
  // Toujours récupérer un tableau, même si on limite à 1 résultat
  let query = supabase
    .from("conversations")
    .select("*")
    .eq("provider_id", provider_id)
    .eq("customer_id", customer_id);

  // Si booking_id est fourni, chercher par booking_id
  if (booking_id) {
    query = query.eq("booking_id", booking_id);
  } else {
    // Sinon, chercher les conversations sans booking_id (pour applications/missions)
    query = query.is("booking_id", null);
    
    // Si application_id est fourni, chercher par application_id (si la colonne existe)
    if (application_id) {
      query = query.eq("application_id", application_id);
    }
    
    // Si offer_id est fourni (et pas d'application_id), chercher aussi par offer_id
    // Cela permet de trouver une conversation existante même si le detailer n'a pas encore postulé
    if (offer_id && !application_id) {
      query = query.eq("offer_id", offer_id);
    }
  }
  
  // ⚠️ CRUCIAL : Ne PAS utiliser .limit(1) ici car cela peut causer PGRST116
  // Récupérer TOUTES les conversations correspondantes et prendre la première
  // Cela évite complètement l'erreur PGRST116

  // ⚠️ SOLUTION DÉFINITIVE : Récupérer TOUTES les conversations correspondantes
  // et prendre la première, au lieu d'utiliser .limit(1) qui peut causer PGRST116
  console.log(`[CHAT] Executing query to find existing conversation...`);
  
  let existing = null;
  
  try {
    // Récupérer TOUTES les conversations correspondantes (pas de .limit(1))
    // Cela évite complètement l'erreur PGRST116
    const { data: allResults, error: queryError } = await query;
    
    if (queryError) {
      // Si erreur de colonne inexistante (42703), refaire la requête sans application_id
      if (queryError.code === "42703" && application_id) {
        console.warn("[CHAT] application_id column does not exist, searching without it");
        const fallbackQuery = supabase
          .from("conversations")
          .select("*")
          .eq("provider_id", provider_id)
          .eq("customer_id", customer_id)
          .is("booking_id", null);
        
        if (offer_id) {
          fallbackQuery.eq("offer_id", offer_id);
        }
        
        const { data: fallbackResults, error: fallbackError } = await fallbackQuery;
        if (fallbackError) {
          throw fallbackError;
        }
        if (fallbackResults && fallbackResults.length > 0) {
          existing = fallbackResults[0];
          console.log(`[CHAT] Found existing conversation (fallback): ${existing.id}`);
        }
      } else {
        throw queryError;
      }
    } else if (allResults && allResults.length > 0) {
      // Prendre la première conversation trouvée
      existing = allResults[0];
      console.log(`[CHAT] Found existing conversation: ${existing.id} (${allResults.length} total)`);
      
      // Si plusieurs conversations existent, log un avertissement
      if (allResults.length > 1) {
        console.warn(`[CHAT] ⚠️ Multiple conversations found (${allResults.length}), using first one: ${existing.id}`);
      }
    }
  } catch (err) {
    console.error("[CHAT] Error fetching conversations:", err);
    throw err;
  }
  
  if (existing) {
    return existing;
  }
  
  console.log(`[CHAT] No existing conversation found, creating new one...`);

  // Créer une nouvelle conversation (existing est null)
  const insertPayload = {
    provider_id,
    customer_id,
    booking_id: booking_id || null,
  };

  // Ajouter application_id et offer_id seulement si fournis
  // (ces colonnes peuvent ne pas exister dans toutes les versions de la DB)
  if (application_id) {
    insertPayload.application_id = application_id;
  }

  if (offer_id) {
    insertPayload.offer_id = offer_id;
  }

  const { data: created, error: createError } = await supabase
    .from("conversations")
    .insert(insertPayload)
    .select("*")
    .single();

  // Si l'erreur est due à une colonne inexistante, réessayer sans ces colonnes
  if (createError && createError.code === "42703") {
    console.warn("[CHAT] Column does not exist, retrying without application_id/offer_id");
    const fallbackPayload = {
      provider_id,
      customer_id,
      booking_id: booking_id || null,
    };
    
    const { data: fallbackCreated, error: fallbackError } = await supabase
      .from("conversations")
      .insert(fallbackPayload)
      .select("*")
      .single();
    
    if (fallbackError) throw fallbackError;
    return fallbackCreated;
  }

  if (createError) {
    console.error(`[CHAT] Error creating conversation:`, {
      code: createError.code,
      message: createError.message,
      details: createError.details,
      hint: createError.hint,
    });
    throw createError;
  }
  
  console.log(`[CHAT] Conversation created successfully: ${created.id}`);
  return created;
}

export async function sendMessage({
  conversation_id,
  sender_id,
  sender_role,
  content,
}) {
  // ✅ VALIDATION COMPLÈTE SELON LES RÈGLES NIOS
  const { validateMessage } = await import("./chatValidation.service.js");
  
  const validation = await validateMessage(conversation_id, sender_id, content);
  
  if (!validation.isValid) {
    const error = new Error(validation.errors.join("; "));
    error.validationErrors = validation.errors;
    throw error;
  }
  
  // Utiliser le contenu sanitized si disponible
  const finalContent = validation.sanitizedContent || content.trim();
  
  console.log(`[CHAT] Sending message: conversation_id=${conversation_id}, sender_id=${sender_id}, sender_role=${sender_role}, content_length=${finalContent.length}`);
  
  if (validation.warning) {
    console.warn(`[CHAT] Warning: ${validation.warning}`);
  }
  
  const { data: message, error } = await supabase
    .from("messages")
    .insert({
      conversation_id,
      sender_id,
      sender_role,
      content: finalContent,
      is_read: false,
    })
    .select("*")
    .single();

  if (error) {
    console.error("[CHAT] Error sending message:", error);
    throw error;
  }
  
  console.log(`[CHAT] Message sent successfully: id=${message.id}`);
  return message;
}

export async function getMessages(conversationId, limit = 50) {
  const { data, error } = await supabase
    .from("messages")
    .select(
      `
        *,
        sender:users!messages_sender_id_fkey(id, email)
      `
    )
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  const messages = (data || []).reverse();
  return messages;
}

export async function getConversations(userId, userRole) {
  let query = supabase
    .from("conversations")
    .select(
      `
        *,
        provider:provider_profiles!conversations_provider_id_fkey(display_name, logo_url),
        customer:users!conversations_customer_id_fkey(id, email),
        booking:bookings(id, service_name, date, status)
      `
    )
    .order("last_message_at", { ascending: false, nullsFirst: false });

  if (userRole === "provider") {
    query = query.eq("provider_id", userId);
  } else if (userRole === "customer" || userRole === "company") {
    // Company utilise customer_id dans la conversation (company = customer dans le contexte chat)
    query = query.eq("customer_id", userId);
  } else {
    return [];
  }

  const { data, error } = await query;

  if (error) throw error;

  const conversationsWithLastMessage = await Promise.all(
    (data || []).map(async conv => {
      const { data: lastMessage } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conv.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { count: unreadCount } = await supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("conversation_id", conv.id)
        .eq("is_read", false)
        .neq("sender_id", userId);

      return {
        ...conv,
        lastMessage: lastMessage || null,
        unreadCount: unreadCount || 0,
      };
    })
  );

  return conversationsWithLastMessage;
}

export async function markMessagesAsRead(conversationId, userId) {
  const { error } = await supabase
    .from("messages")
    .update({ is_read: true })
    .eq("conversation_id", conversationId)
    .neq("sender_id", userId)
    .eq("is_read", false);

  if (error) throw error;
  return true;
}

export async function checkBookingEligibility(bookingId, userId, userRole) {
  const { data: booking, error } = await supabase
    .from("bookings")
    .select("provider_id, customer_id, status")
    .eq("id", bookingId)
    .single();

  if (error || !booking) {
    return { eligible: false, error: "Booking not found" };
  }

  if (userRole === "provider" && booking.provider_id !== userId) {
    return { eligible: false, error: "Not your booking" };
  }
  if (userRole === "customer" && booking.customer_id !== userId) {
    return { eligible: false, error: "Not your booking" };
  }

  const allowedStatuses = [
    "confirmed",
    "started",
    "in_progress",
    "completed",
  ];
  if (!allowedStatuses.includes(booking.status)) {
    return {
      eligible: false,
      error: "Booking must be confirmed to start a conversation",
    };
  }

  return { eligible: true };
}
