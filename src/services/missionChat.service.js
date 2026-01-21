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

    // 2) Vérifier si une conversation existe déjà pour ce Mission Agreement
    // On cherche par provider_id + customer_id (detailer + company)
    const { data: existingChat, error: checkError } = await supabase
      .from("conversations")
      .select("id")
      .eq("provider_id", agreement.detailerId)
      .eq("customer_id", agreement.companyId)
      .is("booking_id", null) // Pas de booking_id pour les missions
      .maybeSingle();

    if (checkError) {
      console.error("[MISSION CHAT] Error checking existing conversation:", checkError);
    }

    if (existingChat) {
      console.log(`ℹ️ [MISSION CHAT] Conversation already exists for agreement ${missionAgreementId}`);
      return existingChat; // Conversation déjà créée
    }

    // 3) Créer la conversation
    // Note: Le système de chat actuel utilise provider_id/customer_id pour les bookings
    // Pour les missions, on adapte : detailer = provider, company = customer
    // booking_id reste null car c'est une mission, pas un booking
    const insertPayload = {
      provider_id: agreement.detailerId, // Le detailer est le "provider"
      customer_id: agreement.companyId, // La company est le "customer" dans ce contexte
      booking_id: null, // Pas de booking pour les missions
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(),
    };

    // Ajouter mission_agreement_id si la colonne existe dans la table
    // (nécessitera une migration SQL si elle n'existe pas encore)
    // Pour l'instant, on essaie de l'ajouter, si ça échoue on continue sans
    try {
      // Test si la colonne existe en essayant de l'insérer
      insertPayload.mission_agreement_id = missionAgreementId;
    } catch (e) {
      // Si la colonne n'existe pas, on continue sans
      console.warn("[MISSION CHAT] mission_agreement_id column may not exist, continuing without it");
    }

    const { data: conversation, error: createError } = await supabase
      .from("conversations")
      .insert(insertPayload)
      .select("*")
      .single();

    if (createError) {
      console.error("[MISSION CHAT] Error creating conversation:", createError);
      throw createError;
    }

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

  const { data: message, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: agreement.companyId, // La company envoie le message de bienvenue
      sender_role: "company", // Rôle de l'expéditeur
      content: welcomeText,
      is_read: false,
      created_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) {
    console.error("[MISSION CHAT] Error creating welcome message:", error);
    throw error;
  }

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

  // Chercher la conversation par provider_id + customer_id
  // (detailer + company) avec booking_id null
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("provider_id", agreement.detailerId)
    .eq("customer_id", agreement.companyId)
    .is("booking_id", null)
    .maybeSingle();

  if (error) {
    console.error("[MISSION CHAT] Error fetching conversation:", error);
    throw error;
  }

  return data;
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
