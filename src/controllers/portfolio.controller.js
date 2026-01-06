import {
  getProviderPortfolio,
  addPortfolioPhoto,
  deletePortfolioPhoto,
  updatePortfolioPhoto,
} from "../services/portfolio.service.js";
import { getProviderProfileIdForUser } from "../services/provider.service.js";

export async function listProviderPortfolio(req, res) {
  try {
    const { id: providerId } = req.params;
    const photos = await getProviderPortfolio(providerId);
    return res.json({ data: photos });
  } catch (err) {
    console.error("[PORTFOLIO] list error:", err);
    return res.status(500).json({ error: "Could not fetch portfolio" });
  }
}

export async function addPortfolioPhotoController(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res
        .status(403)
        .json({ error: "Only providers can add portfolio photos" });
    }

    const providerProfile = await getProviderProfileIdForUser(req.user.id);
    if (!providerProfile || !providerProfile.id) {
      return res.status(404).json({ error: "Provider profile not found" });
    }

    const photo = await addPortfolioPhoto(providerProfile.id, req.body);
    return res.status(201).json(photo);
  } catch (err) {
    console.error("[PORTFOLIO] add error:", err);
    const status = err.statusCode || 500;
    return res
      .status(status)
      .json({ error: err.message || "Could not add photo" });
  }
}

export async function deletePortfolioPhotoController(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res
        .status(403)
        .json({ error: "Only providers can delete portfolio photos" });
    }

    const providerProfile = await getProviderProfileIdForUser(req.user.id);
    if (!providerProfile || !providerProfile.id) {
      return res.status(404).json({ error: "Provider profile not found" });
    }

    const { id: photoId } = req.params;
    await deletePortfolioPhoto(photoId, providerProfile.id);
    return res.json({ success: true });
  } catch (err) {
    console.error("[PORTFOLIO] delete error:", err);
    const status = err.statusCode || 500;
    return res
      .status(status)
      .json({ error: err.message || "Could not delete photo" });
  }
}

export async function updatePortfolioPhotoController(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res
        .status(403)
        .json({ error: "Only providers can update portfolio photos" });
    }

    const providerProfile = await getProviderProfileIdForUser(req.user.id);
    if (!providerProfile || !providerProfile.id) {
      return res.status(404).json({ error: "Provider profile not found" });
    }

    const { id: photoId } = req.params;
    const photo = await updatePortfolioPhoto(
      photoId,
      providerProfile.id,
      req.body
    );
    return res.json(photo);
  } catch (err) {
    console.error("[PORTFOLIO] update error:", err);
    const status = err.statusCode || 500;
    return res
      .status(status)
      .json({ error: err.message || "Could not update photo" });
  }
}
