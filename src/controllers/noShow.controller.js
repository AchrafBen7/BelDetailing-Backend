import { reportNoShow } from "../services/noShow.service.js";
import { supabaseAdmin as supabase } from "../config/supabase.js";

async function getProviderProfileIdForUser(userId) {
  const { data, error } = await supabase
    .from("provider_profiles")
    .select("id, user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return data.id ?? data.user_id ?? null;
}

export async function reportNoShowController(req, res) {
  try {
    const bookingId = req.params.id;
    const userId = req.user.id;

    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can report no-show" });
    }

    const providerProfileId = await getProviderProfileIdForUser(userId);
    if (!providerProfileId) {
      return res.status(404).json({ error: "Provider profile not found" });
    }

    const result = await reportNoShow(bookingId, providerProfileId);

    return res.json({
      success: true,
      partial_payment_amount: result.partialPaymentAmount,
      booking_id: bookingId,
      message: "No-show confirmed. Partial payment transferred to provider.",
    });
  } catch (err) {
    console.error("[NO-SHOW] reportNoShow error:", err);
    const status = err.statusCode || 500;
    return res
      .status(status)
      .json({ error: err.message || "Could not process no-show" });
  }
}
