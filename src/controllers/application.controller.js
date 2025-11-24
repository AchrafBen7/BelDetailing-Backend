import {
  getApplicationsForOffer,
  applyToOffer,
  withdrawApplication,
  acceptApplication,
  refuseApplication,
} from "../services/application.service.js";

// 🔹 GET /api/v1/offers/:offerId/applications
export async function listApplicationsForOffer(req, res) {
  try {
    const { offerId } = req.params;
    // optional: vérifier role === "company" si tu veux restreindre
    if (req.user.role !== "company") {
      return res.status(403).json({ error: "Only companies can view applications" });
    }

    const items = await getApplicationsForOffer(offerId);
    return res.json({ data: items });
  } catch (err) {
    console.error("[APPLICATIONS] list error:", err);
    return res.status(500).json({ error: "Could not fetch applications" });
  }
}

// 🔹 POST /api/v1/offers/:offerId/apply  (provider)
export async function applyToOfferController(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can apply" });
    }

    const { offerId } = req.params;
    const created = await applyToOffer(offerId, req.body, req.user);
    return res.status(201).json(created);
  } catch (err) {
    console.error("[APPLICATIONS] apply error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: "Could not apply to offer" });
  }
}

// 🔹 POST /api/v1/applications/:id/withdraw  (provider)
export async function withdrawApplicationController(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can withdraw applications" });
    }

    const { id } = req.params;
    await withdrawApplication(id, req.user);
    return res.json({ success: true });
  } catch (err) {
    console.error("[APPLICATIONS] withdraw error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: "Could not withdraw application" });
  }
}

// 🔹 POST /api/v1/applications/:id/accept  (company)
export async function acceptApplicationController(req, res) {
  try {
    if (req.user.role !== "company") {
      return res.status(403).json({ error: "Only companies can accept applications" });
    }

    const { id } = req.params;
    await acceptApplication(id, req.user);
    return res.json({ success: true });
  } catch (err) {
    console.error("[APPLICATIONS] accept error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: "Could not accept application" });
  }
}

// 🔹 POST /api/v1/applications/:id/refuse  (company)
export async function refuseApplicationController(req, res) {
  try {
    if (req.user.role !== "company") {
      return res.status(403).json({ error: "Only companies can refuse applications" });
    }

    const { id } = req.params;
    await refuseApplication(id, req.user);
    return res.json({ success: true });
  } catch (err) {
    console.error("[APPLICATIONS] refuse error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: "Could not refuse application" });
  }
}
