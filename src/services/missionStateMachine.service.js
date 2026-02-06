// src/services/missionStateMachine.service.js
/**
 * State Machine stricte pour les transitions de statut de Mission Agreement.
 * 
 * Flow complet :
 * draft → waiting_for_detailer_confirmation → agreement_fully_confirmed
 *   → payment_scheduled → awaiting_start → active
 *   → awaiting_end → completed
 * 
 * Branches :
 *   active → suspended → active (resume)
 *   * → cancelled (avec règles)
 */

const VALID_TRANSITIONS = {
  // Phase 1: Contract negotiation
  draft: ["waiting_for_detailer_confirmation", "cancelled"],
  waiting_for_detailer_confirmation: ["agreement_fully_confirmed", "cancelled"],
  
  // Phase 2: Payment setup
  agreement_fully_confirmed: ["payment_scheduled", "cancelled"],
  
  // Phase 3: Mission execution  
  payment_scheduled: ["awaiting_start", "cancelled"],
  awaiting_start: ["active", "cancelled"],  // Both parties confirmed → active
  active: ["awaiting_end", "suspended", "cancelled"],
  
  // Phase 4: Mission completion
  awaiting_end: ["completed", "active", "cancelled"],  // active = rollback if one retracts
  
  // Suspension
  suspended: ["active", "cancelled"],
  
  // Terminal states (no transitions out)
  completed: [],
  cancelled: [],
};

/**
 * Vérifie si une transition de statut est valide
 * @param {string} currentStatus - Statut actuel
 * @param {string} newStatus - Statut souhaité
 * @returns {boolean}
 */
export function isValidTransition(currentStatus, newStatus) {
  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed) return false;
  return allowed.includes(newStatus);
}

/**
 * Valide une transition et lève une erreur si invalide
 * @param {string} currentStatus
 * @param {string} newStatus
 * @throws {Error} Si la transition est invalide
 */
export function validateTransition(currentStatus, newStatus) {
  if (!isValidTransition(currentStatus, newStatus)) {
    const allowed = VALID_TRANSITIONS[currentStatus] || [];
    const err = new Error(
      `Invalid status transition: ${currentStatus} → ${newStatus}. ` +
      `Allowed transitions from '${currentStatus}': [${allowed.join(", ")}]`
    );
    err.statusCode = 400;
    err.currentStatus = currentStatus;
    err.requestedStatus = newStatus;
    err.allowedTransitions = allowed;
    throw err;
  }
}

/**
 * Retourne les transitions autorisées pour un statut donné
 * @param {string} status
 * @returns {string[]}
 */
export function getAllowedTransitions(status) {
  return VALID_TRANSITIONS[status] || [];
}

/**
 * Vérifie si un statut est terminal (pas de transition possible)
 * @param {string} status
 * @returns {boolean}
 */
export function isTerminalStatus(status) {
  const allowed = VALID_TRANSITIONS[status];
  return !allowed || allowed.length === 0;
}

/**
 * Vérifie si un rôle peut effectuer une action sur une mission
 * @param {string} action - Action à effectuer
 * @param {string} role - Rôle de l'utilisateur
 * @returns {boolean}
 */
export function canPerformAction(action, role) {
  const ACTION_PERMISSIONS = {
    confirm_start: ["company", "provider"],
    confirm_end: ["company", "provider"],
    suspend: ["company", "provider", "admin"],
    resume: ["company", "provider", "admin"],
    cancel: ["company", "provider", "admin"],
    create_payments: ["company"],
  };

  const allowed = ACTION_PERMISSIONS[action];
  if (!allowed) return false;
  return allowed.includes(role);
}
