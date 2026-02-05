// src/services/content-moderation.service.js

/**
 * Service de modération de contenu
 * Filtre le langage offensant et les contenus inappropriés
 * 
 * Utilise une liste de mots (pas d'API tierce pour réduire les coûts)
 */

// Liste de mots profanes/offensants (Français, Anglais, Néerlandais)
const PROFANITY_LIST_FR = [
  // Insultes courantes
  "merde", "putain", "connard", "salope", "enculé", "enculer",
  "salaud", "pute", "con", "conne", "connasse", "batard", "bâtard",
  "fdp", "ntm", "pd", "tapette", "gouine", "nique", "niquer",
  "chier", "chiasse", "emmerde", "emmerder", "bordel",
  
  // Racisme/discrimination
  "negro", "négro", "arabe", "youpin", "bougnoule", "raton",
  
  // Sexuel explicite
  "bite", "couille", "chatte", "cul", "sexe", "baiser",
  "suce", "sucer", "branle", "branler", "pine",
];

const PROFANITY_LIST_EN = [
  // Common insults
  "fuck", "shit", "asshole", "bitch", "bastard", "damn",
  "dick", "cock", "pussy", "cunt", "motherfucker",
  "whore", "slut", "faggot", "nigger", "retard",
  
  // Explicit
  "sex", "porn", "nude", "xxx", "anal",
];

const PROFANITY_LIST_NL = [
  // Belges/Néerlandais
  "kut", "klootzak", "lul", "pik", "kanker", "tering",
  "hoer", "slet", "flikker", "homo", "mof",
];

// Combine toutes les listes
const ALL_PROFANITY = [
  ...PROFANITY_LIST_FR,
  ...PROFANITY_LIST_EN,
  ...PROFANITY_LIST_NL
].map(word => word.toLowerCase());

/**
 * Normalise le texte pour la comparaison
 * - Enlève les accents
 * - Convertit en minuscules
 * - Remplace les caractères spéciaux souvent utilisés pour contourner les filtres
 */
function normalizeText(text) {
  if (!text || typeof text !== "string") return "";
  
  return text
    .toLowerCase()
    // Enlever accents
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Remplacer caractères de substitution courants
    .replace(/[@4]/g, "a")
    .replace(/[3€]/g, "e")
    .replace(/[1!|]/g, "i")
    .replace(/[0]/g, "o")
    .replace(/[5$]/g, "s")
    .replace(/[7]/g, "t")
    // Enlever les espaces multiples
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Vérifie si le texte contient du langage offensant
 * @param {string} text - Texte à vérifier
 * @returns {boolean} - true si profanity détecté
 */
export function containsProfanity(text) {
  if (!text || typeof text !== "string") return false;
  
  const normalized = normalizeText(text);
  
  // Vérifier chaque mot de la liste
  return ALL_PROFANITY.some(word => {
    // Match avec word boundaries pour éviter les faux positifs
    // Ex: "assassin" ne doit pas matcher "ass"
    const regex = new RegExp(`\\b${word}\\b`, "i");
    return regex.test(normalized);
  });
}

/**
 * Trouve les mots offensants dans le texte
 * @param {string} text - Texte à analyser
 * @returns {string[]} - Liste des mots détectés
 */
export function findProfanity(text) {
  if (!text || typeof text !== "string") return [];
  
  const normalized = normalizeText(text);
  const found = [];
  
  ALL_PROFANITY.forEach(word => {
    const regex = new RegExp(`\\b${word}\\b`, "i");
    if (regex.test(normalized)) {
      found.push(word);
    }
  });
  
  return found;
}

/**
 * Modère un texte avant insertion en DB
 * @param {string} text - Texte à modérer
 * @param {string} context - Contexte ('review', 'chat', 'profile', 'bio')
 * @throws {Error} Si contenu inapproprié détecté
 * @returns {boolean} - true si le texte est valide
 */
export function moderateContent(text, context = "general") {
  if (!text || typeof text !== "string") {
    return true; // Texte vide = OK
  }
  
  // Vérifier longueur minimale selon le contexte
  if (context === "review" && text.length < 10) {
    const error = new Error("L'avis doit contenir au moins 10 caractères.");
    error.statusCode = 400;
    error.code = "CONTENT_TOO_SHORT";
    throw error;
  }
  
  if (context === "chat" && text.length < 1) {
    const error = new Error("Le message ne peut pas être vide.");
    error.statusCode = 400;
    error.code = "CONTENT_EMPTY";
    throw error;
  }
  
  // Vérifier longueur maximale
  const maxLengths = {
    review: 1000,
    chat: 2000,
    bio: 500,
    profile: 500,
    general: 2000
  };
  
  const maxLength = maxLengths[context] || maxLengths.general;
  
  if (text.length > maxLength) {
    const error = new Error(
      `Le texte est trop long (maximum ${maxLength} caractères).`
    );
    error.statusCode = 400;
    error.code = "CONTENT_TOO_LONG";
    throw error;
  }
  
  // Vérifier profanity
  if (containsProfanity(text)) {
    const found = findProfanity(text);
    const error = new Error(
      "Le contenu contient du langage inapproprié. Veuillez reformuler votre message."
    );
    error.statusCode = 400;
    error.code = "CONTENT_MODERATION_FAILED";
    error.details = {
      detectedWords: found.length, // Ne pas exposer les mots exacts
      context
    };
    throw error;
  }
  
  // Vérifier spam (répétition excessive)
  if (isSpam(text)) {
    const error = new Error(
      "Le contenu semble être du spam. Veuillez écrire un message normal."
    );
    error.statusCode = 400;
    error.code = "CONTENT_SPAM_DETECTED";
    throw error;
  }
  
  return true;
}

/**
 * Détecte le spam basique (répétition excessive)
 */
function isSpam(text) {
  // Vérifier répétition d'un même caractère (ex: "aaaaaaa")
  const charRepeat = /(.)\1{10,}/;
  if (charRepeat.test(text)) return true;
  
  // Vérifier répétition d'un même mot (ex: "super super super super")
  const words = text.toLowerCase().split(/\s+/);
  const wordCounts = {};
  
  words.forEach(word => {
    if (word.length > 3) { // Ignorer mots courts (le, de, etc.)
      wordCounts[word] = (wordCounts[word] || 0) + 1;
    }
  });
  
  // Si un mot apparaît plus de 5 fois dans un texte court = spam probable
  const maxRepeat = Math.max(...Object.values(wordCounts));
  if (maxRepeat > 5 && text.length < 200) return true;
  
  return false;
}

/**
 * Middleware Express pour modérer automatiquement certains champs
 * Usage: router.post('/chat', moderateBody(['content']), sendMessage)
 */
export function moderateBody(fields = [], context = "general") {
  return async (req, res, next) => {
    try {
      for (const field of fields) {
        const value = req.body[field];
        if (value && typeof value === "string") {
          moderateContent(value, context);
        }
      }
      next();
    } catch (err) {
      return res.status(err.statusCode || 400).json({
        error: err.message,
        code: err.code
      });
    }
  };
}

/**
 * Version asynchrone pour compatibilité future (si on veut ajouter API tierce plus tard)
 */
export async function moderateContentAsync(text, context = "general") {
  return moderateContent(text, context);
}
