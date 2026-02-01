// src/services/bookingProgress.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { createNotification } from "./notification.service.js";

/**
 * Steps par défaut pour un service de nettoyage
 */
export const DEFAULT_SERVICE_STEPS = [
  {
    id: "step_1",
    title: "Préparation",
    percentage: 10,
    is_completed: false,
    order: 1,
    completed_at: null,
  },
  {
    id: "step_2",
    title: "Nettoyage extérieur",
    percentage: 25,
    is_completed: false,
    order: 2,
    completed_at: null,
  },
  {
    id: "step_3",
    title: "Nettoyage intérieur",
    percentage: 30,
    is_completed: false,
    order: 3,
    completed_at: null,
  },
  {
    id: "step_4",
    title: "Finitions",
    percentage: 25,
    is_completed: false,
    order: 4,
    completed_at: null,
  },
  {
    id: "step_5",
    title: "Vérification finale",
    percentage: 10,
    is_completed: false,
    order: 5,
    completed_at: null,
  },
];

/**
 * Initialise le progress pour un booking
 */
function initializeProgress(bookingId) {
  return {
    booking_id: bookingId,
    steps: DEFAULT_SERVICE_STEPS.map(step => ({ ...step })),
    current_step_index: 0,
    total_progress: 0,
    started_at: new Date().toISOString(),
    completed_at: null,
  };
}

/**
 * Démarre un service (confirmed → started/in_progress)
 * @param {string} bookingId - ID du booking
 * @param {string} providerId - ID du provider (vérification de sécurité)
 * @returns {Promise<Object>} Booking mis à jour avec progress
 */
export async function startService(bookingId, providerId) {
  // 1) Vérifier que le booking existe et appartient au provider
  const { data: booking, error: fetchError } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .single();

  if (fetchError) throw fetchError;
  if (!booking) {
    const err = new Error("Booking not found");
    err.statusCode = 404;
    throw err;
  }

  // Vérifier que le provider est le propriétaire
  if (booking.provider_id !== providerId) {
    const err = new Error("You are not the provider of this booking");
    err.statusCode = 403;
    throw err;
  }

  // Vérifier que le statut est "confirmed" ou "ready_soon"
  if (booking.status !== "confirmed" && booking.status !== "ready_soon") {
    const err = new Error(`Booking must be confirmed or ready_soon to start. Current status: ${booking.status}`);
    err.statusCode = 400;
    throw err;
  }

  // 2) Initialiser le progress
  const progress = initializeProgress(bookingId);

  // 3) Mettre à jour le booking
  const { data: updated, error: updateError } = await supabase
    .from("bookings")
    .update({
      status: "started", // ou "in_progress" selon votre logique
      progress,
    })
    .eq("id", bookingId)
    .select("*")
    .single();

  if (updateError) throw updateError;

  // 4) Envoyer une notification au customer
  try {
    await createNotification({
      userId: booking.customer_id,
      title: "Service démarré",
      message: `Le service "${booking.service_name}" a été démarré par ${booking.provider_name}.`,
      type: "service_started",
      data: {
        booking_id: bookingId,
        provider_id: providerId,
      },
    });
  } catch (notifError) {
    console.error("[BOOKING PROGRESS] Error sending notification:", notifError);
    // Ne pas faire échouer le démarrage si la notification échoue
  }

  return updated;
}

/**
 * Marque une étape comme complétée
 * @param {string} bookingId - ID du booking
 * @param {string} stepId - ID de l'étape (step_1, step_2, etc.)
 * @param {string} providerId - ID du provider (vérification de sécurité)
 * @returns {Promise<Object>} Booking mis à jour avec progress
 */
export async function updateProgress(bookingId, stepId, providerId) {
  // 1) Vérifier que le booking existe et appartient au provider
  const { data: booking, error: fetchError } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .single();

  if (fetchError) throw fetchError;
  if (!booking) {
    const err = new Error("Booking not found");
    err.statusCode = 404;
    throw err;
  }

  // Vérifier que le provider est le propriétaire
  if (booking.provider_id !== providerId) {
    const err = new Error("You are not the provider of this booking");
    err.statusCode = 403;
    throw err;
  }

  // Vérifier que le statut est "started" ou "in_progress"
  if (booking.status !== "started" && booking.status !== "in_progress") {
    const err = new Error(`Booking must be started to update progress. Current status: ${booking.status}`);
    err.statusCode = 400;
    throw err;
  }

  // 2) Vérifier que le progress existe
  if (!booking.progress || !booking.progress.steps) {
    const err = new Error("Progress not initialized. Please start the service first.");
    err.statusCode = 400;
    throw err;
  }

  // 3) Trouver l'étape et la marquer comme complétée
  const progress = { ...booking.progress };
  const stepIndex = progress.steps.findIndex(step => step.id === stepId);

  if (stepIndex === -1) {
    const err = new Error(`Step ${stepId} not found`);
    err.statusCode = 404;
    throw err;
  }

  const step = progress.steps[stepIndex];

  // Vérifier que l'étape n'est pas déjà complétée
  if (step.is_completed) {
    const err = new Error(`Step ${stepId} is already completed`);
    err.statusCode = 400;
    throw err;
  }

  // Vérifier que les étapes précédentes sont complétées
  for (let i = 0; i < stepIndex; i++) {
    if (!progress.steps[i].is_completed) {
      const err = new Error(`Previous step ${progress.steps[i].id} must be completed first`);
      err.statusCode = 400;
      throw err;
    }
  }

  // Marquer l'étape comme complétée
  step.is_completed = true;
  step.completed_at = new Date().toISOString();

  // Mettre à jour le total_progress
  progress.total_progress = progress.steps
    .filter(s => s.is_completed)
    .reduce((sum, s) => sum + s.percentage, 0);

  // Mettre à jour current_step_index
  progress.current_step_index = stepIndex + 1;

  // 4) Mettre à jour le booking
  const { data: updated, error: updateError } = await supabase
    .from("bookings")
    .update({
      progress,
      status: progress.total_progress === 100 ? "in_progress" : "started", // Si 100%, on peut passer à "in_progress"
    })
    .eq("id", bookingId)
    .select("*")
    .single();

  if (updateError) throw updateError;

  // 5) Envoyer une notification au customer
  try {
    await createNotification({
      userId: booking.customer_id,
      title: "Progression du service",
      message: `Étape "${step.title}" complétée (${progress.total_progress}% terminé).`,
      type: "service_progress_updated",
      data: {
        booking_id: bookingId,
        step_id: stepId,
        step_title: step.title,
        total_progress: progress.total_progress,
      },
    });
  } catch (notifError) {
    console.error("[BOOKING PROGRESS] Error sending notification:", notifError);
  }

  return updated;
}

/**
 * Marque le service comme terminé
 * @param {string} bookingId - ID du booking
 * @param {string} providerId - ID du provider (vérification de sécurité)
 * @returns {Promise<Object>} Booking mis à jour
 */
export async function completeService(bookingId, providerId) {
  // 1) Vérifier que le booking existe et appartient au provider
  const { data: booking, error: fetchError } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .single();

  if (fetchError) throw fetchError;
  if (!booking) {
    const err = new Error("Booking not found");
    err.statusCode = 404;
    throw err;
  }

  // Vérifier que le provider est le propriétaire
  if (booking.provider_id !== providerId) {
    const err = new Error("You are not the provider of this booking");
    err.statusCode = 403;
    throw err;
  }

  // Vérifier que le statut est "started" ou "in_progress"
  if (booking.status !== "started" && booking.status !== "in_progress") {
    const err = new Error(`Booking must be started to complete. Current status: ${booking.status}`);
    err.statusCode = 400;
    throw err;
  }

  // 2) Vérifier que toutes les étapes sont complétées
  if (booking.progress && booking.progress.steps) {
    const allCompleted = booking.progress.steps.every(step => step.is_completed);
    if (!allCompleted) {
      const err = new Error("All steps must be completed before marking the service as complete");
      err.statusCode = 400;
      throw err;
    }

    // Mettre à jour le progress
    const progress = { ...booking.progress };
    progress.completed_at = new Date().toISOString();
    progress.total_progress = 100;

    // 3) Mettre à jour le booking
    const { data: updated, error: updateError } = await supabase
      .from("bookings")
      .update({
        status: "completed",
        progress,
      })
      .eq("id", bookingId)
      .select("*")
      .single();

    if (updateError) throw updateError;

    // 4) Envoyer une notification au customer
    try {
      await createNotification({
        userId: booking.customer_id,
        title: "Service terminé",
        message: `Le service "${booking.service_name}" a été terminé par ${booking.provider_name}.`,
        type: "service_completed",
        data: {
          booking_id: bookingId,
          provider_id: providerId,
        },
      });
    } catch (notifError) {
      console.error("[BOOKING PROGRESS] Error sending notification:", notifError);
    }

    return updated;
  } else {
    // Si pas de progress, on marque juste comme terminé
    const { data: updated, error: updateError } = await supabase
      .from("bookings")
      .update({
        status: "completed",
      })
      .eq("id", bookingId)
      .select("*")
      .single();

    if (updateError) throw updateError;

    return updated;
  }
}
