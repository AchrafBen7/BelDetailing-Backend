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
    
    // PRIORITÉ 1 : Si application_id est fourni, chercher d'abord par application_id
    // C'est le cas le plus spécifique (conversation liée à une candidature)
    if (application_id) {
      query = query.eq("application_id", application_id);
    } else if (offer_id) {
      // PRIORITÉ 2 : Si offer_id est fourni (sans application_id), chercher par offer_id
      // Cela permet de trouver une conversation existante pour cette offre
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
      // Si erreur de colonne inexistante (42703), refaire la requête sans application_id/offer_id
      if (queryError.code === "42703") {
        console.warn("[CHAT] Column does not exist, searching without application_id/offer_id");
        const fallbackQuery = supabase
          .from("conversations")
          .select("*")
          .eq("provider_id", provider_id)
          .eq("customer_id", customer_id)
          .is("booking_id", null);
        
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
    } else {
      // Si aucune conversation trouvée avec les critères stricts, essayer une recherche plus large
      // (par exemple, si on cherche avec application_id mais qu'une conversation existe avec offer_id seulement)
      if (application_id || offer_id) {
        console.log(`[CHAT] No conversation found with strict criteria, trying broader search...`);
        const broaderQuery = supabase
          .from("conversations")
          .select("*")
          .eq("provider_id", provider_id)
          .eq("customer_id", customer_id)
          .is("booking_id", null);
        
        // Si on cherche avec application_id mais qu'une conversation existe avec offer_id seulement
        if (application_id && offer_id) {
          broaderQuery.eq("offer_id", offer_id);
        } else if (offer_id) {
          broaderQuery.eq("offer_id", offer_id);
        }
        
        const { data: broaderResults, error: broaderError } = await broaderQuery;
        
        if (!broaderError && broaderResults && broaderResults.length > 0) {
          existing = broaderResults[0];
          console.log(`[CHAT] Found existing conversation with broader search: ${existing.id}`);
          
          // Si la conversation existe mais n'a pas d'application_id et qu'on en a un maintenant,
          // mettre à jour la conversation pour lier l'application_id
          if (application_id && !existing.application_id) {
            console.log(`[CHAT] Updating conversation ${existing.id} with application_id: ${application_id}`);
            const { data: updated, error: updateError } = await supabase
              .from("conversations")
              .update({ application_id })
              .eq("id", existing.id)
              .select("*");
            
            if (!updateError && updated && updated.length > 0) {
              existing = updated[0];
              console.log(`[CHAT] Conversation updated successfully with application_id`);
            } else {
              console.warn(`[CHAT] Failed to update conversation with application_id:`, updateError);
            }
          }
        }
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

  // ⚠️ CRUCIAL : Ne PAS utiliser .single() ici car cela peut causer PGRST116
  // Récupérer un tableau et prendre le premier élément
  const { data: createdArray, error: createError } = await supabase
    .from("conversations")
    .insert(insertPayload)
    .select("*");

  // Si l'erreur est due à une colonne inexistante, réessayer sans ces colonnes
  if (createError && createError.code === "42703") {
    console.warn("[CHAT] Column does not exist, retrying without application_id/offer_id");
    const fallbackPayload = {
      provider_id,
      customer_id,
      booking_id: booking_id || null,
    };
    
    const { data: fallbackCreatedArray, error: fallbackError } = await supabase
      .from("conversations")
      .insert(fallbackPayload)
      .select("*");
    
    if (fallbackError) throw fallbackError;
    if (!fallbackCreatedArray || fallbackCreatedArray.length === 0) {
      throw new Error("Failed to create conversation (fallback)");
    }
    console.log(`[CHAT] Conversation created successfully (fallback): ${fallbackCreatedArray[0].id}`);
    return fallbackCreatedArray[0];
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
  
  if (!createdArray || createdArray.length === 0) {
    throw new Error("Failed to create conversation (no data returned)");
  }
  
  console.log(`[CHAT] Conversation created successfully: ${createdArray[0].id}`);
  return createdArray[0];
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
