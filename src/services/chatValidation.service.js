// src/services/chatValidation.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";

// ============================================================
// CONSTANTES DES RÈGLES CHAT NIOS
// ============================================================

const MAX_MESSAGE_LENGTH = 1000; // Limite stricte : 1000 caractères
const WARNING_MESSAGE_LENGTH = 800; // Warning visuel à partir de 800
const MAX_MESSAGES_PER_MINUTE = 10; // Rate limit : 10 messages/minute
const MAX_MESSAGES_PER_MISSION = 200; // Soft cap : 200 messages/mission

// ============================================================
// VALIDATION DES COORDONNÉES PERSONNELLES
// ============================================================

/**
 * Détecte et bloque les coordonnées personnelles dans le message
 * @param {string} content - Contenu du message
 * @returns {Object} { isValid: boolean, blockedPatterns: string[], sanitizedContent: string }
 */
export function validatePersonalInfo(content) {
  const blockedPatterns = [];
  let sanitizedContent = content;

  // Regex pour détecter les patterns interdits
  const patterns = [
    // Numéros de téléphone (international, belge, français, etc.)
    {
      regex: /(\+?\d{1,4}[\s-]?)?\(?\d{1,4}\)?[\s.-]?\d{1,4}[\s.-]?\d{1,4}[\s.-]?\d{1,4}[\s.-]?\d{1,4}/g,
      name: "numéro de téléphone",
    },
    // Emails
    {
      regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      name: "adresse email",
    },
    // URLs externes (sauf nios.app, beldetailing.com, etc.)
    {
      regex: /https?:\/\/(?!.*(nios\.app|beldetailing\.com|localhost))[^\s]+/gi,
      name: "lien externe",
    },
    // WhatsApp links
    {
      regex: /wa\.me|whatsapp\.com/gi,
      name: "lien WhatsApp",
    },
    // Instagram
    {
      regex: /instagram\.com|instagr\.am/gi,
      name: "lien Instagram",
    },
    // Facebook
    {
      regex: /facebook\.com|fb\.com|fb\.me/gi,
      name: "lien Facebook",
    },
    // Autres réseaux sociaux
    {
      regex: /(linkedin|twitter|tiktok|snapchat)\.com/gi,
      name: "réseau social",
    },
  ];

  // Vérifier chaque pattern
  for (const pattern of patterns) {
    const matches = content.match(pattern.regex);
    if (matches && matches.length > 0) {
      blockedPatterns.push(pattern.name);
      // Masquer le contenu détecté
      sanitizedContent = sanitizedContent.replace(pattern.regex, "[Coordonnées non autorisées]");
    }
  }

  return {
    isValid: blockedPatterns.length === 0,
    blockedPatterns,
    sanitizedContent,
  };
}

// ============================================================
// RATE LIMITING
// ============================================================

/**
 * Vérifie le rate limit pour un utilisateur dans une conversation
 * @param {string} conversationId - ID de la conversation
 * @param {string} senderId - ID de l'expéditeur
 * @returns {Promise<Object>} { allowed: boolean, reason?: string }
 */
export async function checkRateLimit(conversationId, senderId) {
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();

  // Compter les messages de cet utilisateur dans cette conversation dans la dernière minute
  const { count: recentMessages, error: recentError } = await supabase
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("sender_id", senderId)
    .gte("created_at", oneMinuteAgo);

  if (recentError) {
    console.error("[CHAT VALIDATION] Error checking rate limit:", recentError);
    // En cas d'erreur, on autorise (fail open pour ne pas bloquer l'utilisateur)
    return { allowed: true };
  }

  if (recentMessages >= MAX_MESSAGES_PER_MINUTE) {
    return {
      allowed: false,
      reason: `Trop de messages envoyés. Limite : ${MAX_MESSAGES_PER_MINUTE} messages par minute.`,
    };
  }

  return { allowed: true };
}

/**
 * Vérifie le soft cap de messages par mission
 * @param {string} conversationId - ID de la conversation
 * @returns {Promise<Object>} { allowed: boolean, count: number, reason?: string }
 */
export async function checkMissionMessageCap(conversationId) {
  // Compter tous les messages de cette conversation
  const { count: totalMessages, error: countError } = await supabase
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("conversation_id", conversationId);

  if (countError) {
    console.error("[CHAT VALIDATION] Error counting messages:", countError);
    return { allowed: true, count: 0 };
  }

  if (totalMessages >= MAX_MESSAGES_PER_MISSION) {
    return {
      allowed: false,
      count: totalMessages,
      reason: `Limite de messages atteinte pour cette mission (${MAX_MESSAGES_PER_MISSION} messages maximum).`,
    };
  }

  return {
    allowed: true,
    count: totalMessages,
  };
}

// ============================================================
// VALIDATION DU CONTEXTE (CANDIDATURE/MISSION/OFFRE)
// ============================================================

/**
 * Vérifie que le chat est autorisé dans le contexte actuel
 * @param {string} conversationId - ID de la conversation
 * @returns {Promise<Object>} { allowed: boolean, reason?: string }
 */
export async function validateChatContext(conversationId) {
  // Récupérer la conversation avec ses relations
  const { data: conversation, error: convError } = await supabase
    .from("conversations")
    .select("application_id, offer_id, booking_id")
    .eq("id", conversationId)
    .single();

  if (convError || !conversation) {
    return {
      allowed: false,
      reason: "Conversation introuvable",
    };
  }

  // Cas 1: Conversation liée à une application
  if (conversation.application_id) {
    const { data: application, error: appError } = await supabase
      .from("applications")
      .select("status")
      .eq("id", conversation.application_id)
      .single();

    if (appError || !application) {
      return {
        allowed: false,
        reason: "Candidature introuvable",
      };
    }

    // Chat autorisé si candidature envoyée, en examen, acceptée
    const allowedStatuses = ["submitted", "underReview", "accepted"];
    if (!allowedStatuses.includes(application.status)) {
      return {
        allowed: false,
        reason: "Le chat n'est pas disponible pour cette candidature",
      };
    }
  }

  // Cas 2: Conversation liée à une mission (Mission Agreement)
  // Vérifier via offer_id si une mission existe
  if (conversation.offer_id) {
    const { data: missionAgreement, error: missionError } = await supabase
      .from("mission_agreements")
      .select("status")
      .eq("offer_id", conversation.offer_id)
      .in("status", ["draft", "waiting_for_detailer_confirmation", "agreement_fully_confirmed", "active"])
      .limit(1)
      .maybeSingle();

    if (!missionError && missionAgreement) {
      // Mission trouvée, vérifier son statut
      const allowedStatuses = [
        "draft",
        "waiting_for_detailer_confirmation",
        "agreement_fully_confirmed",
        "active",
      ];
      if (!allowedStatuses.includes(missionAgreement.status)) {
        return {
          allowed: false,
          reason: "Le chat est fermé pour cette mission",
        };
      }
    }
  }

  // Cas 3: Conversation liée à un booking
  if (conversation.booking_id) {
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("status")
      .eq("id", conversation.booking_id)
      .single();

    if (bookingError || !booking) {
      return {
        allowed: false,
        reason: "Réservation introuvable",
      };
    }

    // Chat autorisé seulement si booking confirmé, démarré, en cours, ou complété
    const allowedStatuses = ["confirmed", "started", "in_progress", "completed"];
    if (!allowedStatuses.includes(booking.status)) {
      return {
        allowed: false,
        reason: "Le chat n'est pas disponible pour cette réservation",
      };
    }
  }

  // Si aucune relation trouvée, refuser (chat doit être dans un contexte précis)
  if (!conversation.application_id && !conversation.offer_id && !conversation.booking_id) {
    return {
      allowed: false,
      reason: "Le chat n'est disponible que dans un contexte de candidature, mission ou réservation",
    };
  }

  return { allowed: true };
}

// ============================================================
// VALIDATION COMPLÈTE D'UN MESSAGE
// ============================================================

/**
 * Valide un message avant envoi (toutes les règles NIOS)
 * @param {string} conversationId - ID de la conversation
 * @param {string} senderId - ID de l'expéditeur
 * @param {string} content - Contenu du message
 * @returns {Promise<Object>} { isValid: boolean, errors: string[], sanitizedContent?: string }
 */
export async function validateMessage(conversationId, senderId, content) {
  const errors = [];

  // 1. Validation de la longueur
  if (!content || content.trim().length === 0) {
    errors.push("Le message ne peut pas être vide");
    return { isValid: false, errors };
  }

  if (content.length > MAX_MESSAGE_LENGTH) {
    errors.push(`Le message est trop long (maximum ${MAX_MESSAGE_LENGTH} caractères)`);
    return { isValid: false, errors };
  }

  // 2. Validation des coordonnées personnelles
  const personalInfoCheck = validatePersonalInfo(content);
  if (!personalInfoCheck.isValid) {
    errors.push(
      `Coordonnées personnelles détectées (${personalInfoCheck.blockedPatterns.join(", ")}). Pour votre sécurité, les coordonnées externes ne sont pas autorisées.`
    );
    // On retourne le contenu sanitized mais on marque comme invalide
    return {
      isValid: false,
      errors,
      sanitizedContent: personalInfoCheck.sanitizedContent,
    };
  }

  // 3. Validation du contexte
  const contextCheck = await validateChatContext(conversationId);
  if (!contextCheck.allowed) {
    errors.push(contextCheck.reason || "Le chat n'est pas disponible dans ce contexte");
    return { isValid: false, errors };
  }

  // 4. Rate limiting
  const rateLimitCheck = await checkRateLimit(conversationId, senderId);
  if (!rateLimitCheck.allowed) {
    errors.push(rateLimitCheck.reason || "Trop de messages envoyés");
    return { isValid: false, errors };
  }

  // 5. Soft cap par mission (warning seulement, pas de blocage)
  const capCheck = await checkMissionMessageCap(conversationId);
  if (!capCheck.allowed) {
    // Soft cap : on autorise mais on log un warning
    console.warn(
      `[CHAT VALIDATION] Soft cap atteint pour conversation ${conversationId}: ${capCheck.count} messages`
    );
  }

  return {
    isValid: true,
    errors: [],
    sanitizedContent: content.trim(),
    warning: capCheck.count >= MAX_MESSAGES_PER_MISSION * 0.9 ? "Vous approchez de la limite de messages pour cette mission" : null,
  };
}

// ============================================================
// EXPORTS
// ============================================================

export {
  MAX_MESSAGE_LENGTH,
  WARNING_MESSAGE_LENGTH,
  MAX_MESSAGES_PER_MINUTE,
  MAX_MESSAGES_PER_MISSION,
};
