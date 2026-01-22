import { supabaseAdmin as supabase } from "../config/supabase.js";

export async function createOrGetConversation({
  provider_id,
  customer_id,
  booking_id,
  application_id,
  offer_id,
}) {
  // Construire la requête de recherche
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

  const { data: existing, error: findError } = await query.maybeSingle();

  // Si l'erreur est due à une colonne inexistante (application_id), on ignore et on continue
  if (findError) {
    // Si c'est une erreur de colonne inexistante, on refait la requête sans application_id
    if (findError.code === "42703" && application_id) {
      console.warn("[CHAT] application_id column does not exist, searching without it");
      const fallbackQuery = supabase
        .from("conversations")
        .select("*")
        .eq("provider_id", provider_id)
        .eq("customer_id", customer_id)
        .is("booking_id", null);
      
      const { data: fallbackExisting, error: fallbackError } = await fallbackQuery.maybeSingle();
      if (fallbackError) throw fallbackError;
      if (fallbackExisting) return fallbackExisting;
    } else {
      throw findError;
    }
  }

  if (existing) {
    return existing;
  }

  // Créer une nouvelle conversation
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

  if (createError) throw createError;
  return created;
}

export async function sendMessage({
  conversation_id,
  sender_id,
  sender_role,
  content,
}) {
  const { data: message, error } = await supabase
    .from("messages")
    .insert({
      conversation_id,
      sender_id,
      sender_role,
      content,
      is_read: false,
    })
    .select("*")
    .single();

  if (error) throw error;
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
  } else if (userRole === "customer") {
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
