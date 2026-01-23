// src/services/missionChat.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { getMissionAgreementById } from "./missionAgreement.service.js";

/**
 * 🟦 CREATE MISSION CHAT – Créer automatiquement une conversation de chat pour un Mission Agreement
 * 
 * Cette fonction crée une conversation entre la company et le detailer pour un Mission Agreement.
 * Elle est appelée automatiquement lors de l'acceptation d'une candidature.
 * 
 * @param {string} missionAgreementId - ID du Mission Agreement
 * @returns {Promise<Object|null>} Conversation créée ou null si erreur
 */
export async function createMissionChat(missionAgreementId) {
  try {
    // 1) Récupérer le Mission Agreement
    const agreement = await getMissionAgreementById(missionAgreementId);
    if (!agreement) {
      throw new Error("Mission Agreement not found");
    }

    // 2) Récupérer l'application_id depuis le Mission Agreement pour lier la conversation
    const { data: agreementRow, error: agreementError } = await supabase
      .from("mission_agreements")
      .select("application_id, offer_id")
      .eq("id", missionAgreementId)
      .single();

    if (agreementError || !agreementRow) {
      console.error("[MISSION CHAT] Error fetching agreement:", agreementError);
      throw new Error("Mission Agreement not found");
    }

    // 3) Vérifier si une conversation existe déjà pour ce Mission Agreement
    // On cherche par provider_id + customer_id + application_id (ou offer_id si pas d'application_id)
    // ⚠️ IMPORTANT : Ne JAMAIS utiliser .single() ou .maybeSingle() ici
    // Toujours récupérer un tableau et prendre le premier élément
    let query = supabase
      .from("conversations")
      .select("*")
      .eq("provider_id", agreement.detailerId)
      .eq("customer_id", agreement.companyId)
      .is("booking_id", null); // Pas de booking_id pour les missions

    // Si application_id existe, chercher par application_id (le plus spécifique)
    if (agreementRow.application_id) {
      query = query.eq("application_id", agreementRow.application_id);
    } else if (agreementRow.offer_id) {
      // Sinon, chercher par offer_id
      query = query.eq("offer_id", agreementRow.offer_id);
    }

    // Récupérer TOUTES les conversations correspondantes (pas de .limit(1))
    const { data: allChats, error: checkError } = await query;

    if (checkError) {
      // Si erreur de colonne inexistante (42703), refaire la requête sans application_id/offer_id
      if (checkError.code === "42703") {
        console.warn("[MISSION CHAT] application_id/offer_id column does not exist, searching without it");
        const fallbackQuery = supabase
          .from("conversations")
          .select("*")
          .eq("provider_id", agreement.detailerId)
          .eq("customer_id", agreement.companyId)
          .is("booking_id", null);
        
        const { data: fallbackChats, error: fallbackError } = await fallbackQuery;
        if (fallbackError) {
          console.error("[MISSION CHAT] Error checking existing conversation (fallback):", fallbackError);
        } else if (fallbackChats && fallbackChats.length > 0) {
          const existingChat = fallbackChats[0];
          console.log(`ℹ️ [MISSION CHAT] Conversation already exists for agreement ${missionAgreementId} (fallback): ${existingChat.id}`);
          return existingChat;
        }
      } else {
        console.error("[MISSION CHAT] Error checking existing conversation:", checkError);
      }
    } else if (allChats && allChats.length > 0) {
      const existingChat = allChats[0];
      console.log(`ℹ️ [MISSION CHAT] Conversation already exists for agreement ${missionAgreementId}: ${existingChat.id} (${allChats.length} total)`);
      
      // Si plusieurs conversations existent, log un avertissement
      if (allChats.length > 1) {
        console.warn(`⚠️ [MISSION CHAT] Multiple conversations found (${allChats.length}), using first one: ${existingChat.id}`);
      }
      
      return existingChat; // Conversation déjà créée
    }

    // 4) Créer la conversation
    // Note: Le système de chat actuel utilise provider_id/customer_id pour les bookings
    // Pour les missions, on adapte : detailer = provider, company = customer
    // booking_id reste null car c'est une mission, pas un booking
    const insertPayload = {
      provider_id: agreement.detailerId, // Le detailer est le "provider"
      customer_id: agreement.companyId, // La company est le "customer" dans ce contexte
      booking_id: null, // Pas de booking pour les missions
    };

    // Ajouter application_id et offer_id si disponibles (pour lier la conversation à l'application/offre)
    if (agreementRow.application_id) {
      insertPayload.application_id = agreementRow.application_id;
    }
    if (agreementRow.offer_id) {
      insertPayload.offer_id = agreementRow.offer_id;
    }

    // ⚠️ CRUCIAL : Ne PAS utiliser .single() ici car cela peut causer PGRST116
    // Récupérer un tableau et prendre le premier élément
    const { data: conversationArray, error: createError } = await supabase
      .from("conversations")
      .insert(insertPayload)
      .select("*");

    // Si l'erreur est due à une colonne inexistante, réessayer sans application_id/offer_id
    if (createError && createError.code === "42703") {
      console.warn("[MISSION CHAT] Column does not exist, retrying without application_id/offer_id");
      const fallbackPayload = {
        provider_id: agreement.detailerId,
        customer_id: agreement.companyId,
        booking_id: null,
      };
      
      const { data: fallbackArray, error: fallbackError } = await supabase
        .from("conversations")
        .insert(fallbackPayload)
        .select("*");
      
      if (fallbackError) {
        console.error("[MISSION CHAT] Error creating conversation (fallback):", fallbackError);
        throw fallbackError;
      }
      
      if (!fallbackArray || fallbackArray.length === 0) {
        throw new Error("Failed to create conversation (fallback, no data returned)");
      }
      
      const conversation = fallbackArray[0];
      console.log(`✅ [MISSION CHAT] Conversation created (fallback): ${conversation.id} for agreement ${missionAgreementId}`);
      
      // Créer le message de bienvenue
      try {
        await createWelcomeMessage(conversation.id, agreement);
      } catch (welcomeError) {
        console.error("[MISSION CHAT] Error creating welcome message:", welcomeError);
      }
      
      return conversation;
    }

    if (createError) {
      console.error("[MISSION CHAT] Error creating conversation:", createError);
      throw createError;
    }
    
    if (!conversationArray || conversationArray.length === 0) {
      throw new Error("Failed to create conversation (no data returned)");
    }
    
    const conversation = conversationArray[0];

    console.log(`✅ [MISSION CHAT] Conversation created: ${conversation.id} for agreement ${missionAgreementId}`);

    // 4) Créer un message de bienvenue automatique
    try {
      await createWelcomeMessage(conversation.id, agreement);
    } catch (welcomeError) {
      console.error("[MISSION CHAT] Error creating welcome message:", welcomeError);
      // Ne pas faire échouer la création de la conversation si le message de bienvenue échoue
    }

    return conversation;
  } catch (err) {
    console.error(`❌ [MISSION CHAT] Failed to create chat for agreement ${missionAgreementId}:`, err);
    // Ne pas faire échouer le processus, juste logger l'erreur
    return null;
  }
}

/**
 * 🟦 CREATE WELCOME MESSAGE – Créer un message de bienvenue automatique dans la conversation
 * 
 * @param {string} conversationId - ID de la conversation
 * @param {Object} agreement - Mission Agreement
 */
async function createWelcomeMessage(conversationId, agreement) {
  const welcomeText = `Bonjour ! Votre candidature pour la mission "${agreement.title || "Mission"}" a été acceptée. Vous pouvez maintenant communiquer directement via cette conversation pour coordonner les détails de la mission.`;

  // ⚠️ CRUCIAL : Ne PAS utiliser .single() ici car cela peut causer PGRST116
  // Récupérer un tableau et prendre le premier élément
  const { data: messageArray, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: agreement.companyId, // La company envoie le message de bienvenue
      sender_role: "company", // Rôle de l'expéditeur
      content: welcomeText,
      is_read: false,
      created_at: new Date().toISOString(),
    })
    .select("*");

  if (error) {
    console.error("[MISSION CHAT] Error creating welcome message:", error);
    throw error;
  }
  
  if (!messageArray || messageArray.length === 0) {
    throw new Error("Failed to create welcome message (no data returned)");
  }
  
  const message = messageArray[0];

  // Mettre à jour la date de mise à jour de la conversation
  await supabase
    .from("conversations")
    .update({
      updated_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(),
    })
    .eq("id", conversationId);

  console.log(`✅ [MISSION CHAT] Welcome message created for conversation ${conversationId}`);

  return message;
}

/**
 * 🟦 GET MISSION CHAT – Récupérer la conversation d'un Mission Agreement
 * 
 * @param {string} missionAgreementId - ID du Mission Agreement
 * @returns {Promise<Object|null>} Conversation ou null si non trouvée
 */
export async function getMissionChat(missionAgreementId) {
  // Récupérer le Mission Agreement pour obtenir les IDs
  const agreement = await getMissionAgreementById(missionAgreementId);
  if (!agreement) {
    return null;
  }

  // Récupérer l'application_id depuis le Mission Agreement pour lier la conversation
  const { data: agreementRow, error: agreementError } = await supabase
    .from("mission_agreements")
    .select("application_id, offer_id")
    .eq("id", missionAgreementId)
    .single();

  if (agreementError || !agreementRow) {
    console.error("[MISSION CHAT] Error fetching agreement:", agreementError);
    return null;
  }

  // Chercher la conversation par provider_id + customer_id + application_id (ou offer_id)
  // ⚠️ IMPORTANT : Ne JAMAIS utiliser .single() ou .maybeSingle() ici
  let query = supabase
    .from("conversations")
    .select("*")
    .eq("provider_id", agreement.detailerId)
    .eq("customer_id", agreement.companyId)
    .is("booking_id", null);

  // Si application_id existe, chercher par application_id (le plus spécifique)
  if (agreementRow.application_id) {
    query = query.eq("application_id", agreementRow.application_id);
  } else if (agreementRow.offer_id) {
    // Sinon, chercher par offer_id
    query = query.eq("offer_id", agreementRow.offer_id);
  }

  // Récupérer TOUTES les conversations correspondantes (pas de .limit(1))
  const { data: allChats, error } = await query;

  if (error) {
    // Si erreur de colonne inexistante (42703), refaire la requête sans application_id/offer_id
    if (error.code === "42703") {
      console.warn("[MISSION CHAT] application_id/offer_id column does not exist, searching without it");
      const fallbackQuery = supabase
        .from("conversations")
        .select("*")
        .eq("provider_id", agreement.detailerId)
        .eq("customer_id", agreement.companyId)
        .is("booking_id", null);
      
      const { data: fallbackChats, error: fallbackError } = await fallbackQuery;
      if (fallbackError) {
        console.error("[MISSION CHAT] Error fetching conversation (fallback):", fallbackError);
        return null;
      }
      
      if (fallbackChats && fallbackChats.length > 0) {
        return fallbackChats[0];
      }
    } else {
      console.error("[MISSION CHAT] Error fetching conversation:", error);
      return null;
    }
  }

  if (allChats && allChats.length > 0) {
    return allChats[0];
  }

  return null;
}

/**
 * 🟦 GET OR CREATE MISSION CHAT – Récupérer ou créer la conversation d'un Mission Agreement
 * 
 * @param {string} missionAgreementId - ID du Mission Agreement
 * @returns {Promise<Object>} Conversation (existante ou créée)
 */
export async function getOrCreateMissionChat(missionAgreementId) {
  // Essayer de récupérer la conversation existante
  const existing = await getMissionChat(missionAgreementId);

  if (existing) {
    return existing;
  }

  // Si elle n'existe pas, la créer
  return await createMissionChat(missionAgreementId);
}
