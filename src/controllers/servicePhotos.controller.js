import {
  getServicePhotos,
  addServicePhoto,
  deleteServicePhoto,
} from "../services/servicePhotos.service.js";
import { getProviderProfileIdForUser } from "../services/provider.service.js";

export async function listServicePhotos(req, res) {
  try {
    const { id: serviceId } = req.params;
    const photos = await getServicePhotos(serviceId);
    return res.json({ data: photos });
  } catch (err) {
    console.error("[SERVICE PHOTOS] list error:", err);
    return res.status(500).json({ error: "Could not fetch service photos" });
  }
}

export async function addServicePhotoController(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res
        .status(403)
        .json({ error: "Only providers can add service photos" });
    }

    const providerProfile = await getProviderProfileIdForUser(req.user.id);
    if (!providerProfile || !providerProfile.id) {
      return res.status(404).json({ error: "Provider profile not found" });
    }

    const { id: serviceId } = req.params;
    const photo = await addServicePhoto(serviceId, req.body, providerProfile.id);
    return res.status(201).json(photo);
  } catch (err) {
    console.error("[SERVICE PHOTOS] add error:", err);
    const status = err.statusCode || 500;
    return res
      .status(status)
      .json({ error: err.message || "Could not add photo" });
  }
}

export async function deleteServicePhotoController(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res
        .status(403)
        .json({ error: "Only providers can delete service photos" });
    }

    const providerProfile = await getProviderProfileIdForUser(req.user.id);
    if (!providerProfile || !providerProfile.id) {
      return res.status(404).json({ error: "Provider profile not found" });
    }

    const { id: serviceId, photoId } = req.params;
    await deleteServicePhoto(serviceId, photoId, providerProfile.id);
    return res.json({ success: true });
  } catch (err) {
    console.error("[SERVICE PHOTOS] delete error:", err);
    const status = err.statusCode || 500;
    return res
      .status(status)
      .json({ error: err.message || "Could not delete photo" });
  }
}
