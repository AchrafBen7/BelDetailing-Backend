import { supabaseAdmin as supabase } from "../config/supabase.js";

export async function createOrGetConversation({
  provider_id,
  customer_id,
  booking_id,
}) {
  const { data: existing, error: findError } = await supabase
    .from("conversations")
    .select("*")
    .eq("provider_id", provider_id)
    .eq("customer_id", customer_id)
    .eq("booking_id", booking_id)
    .maybeSingle();

  if (findError) throw findError;

  if (existing) {
    return existing;
  }

  const { data: created, error: createError } = await supabase
    .from("conversations")
    .insert({
      provider_id,
      customer_id,
      booking_id,
    })
    .select("*")
    .single();

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
