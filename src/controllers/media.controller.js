// src/controllers/media.controller.js
import { supabaseAdmin } from "../config/supabase.js";
import { nanoid } from "nanoid";

export async function uploadMedia(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file provided" });
    }

    const file = req.file;
    const userId = req.user.id;
    const rawExt = (file.originalname.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");

    // 🔒 SECURITY: Whitelist des extensions autorisées
    const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "mp4", "mov", "pdf"]);
    if (!ALLOWED_EXTENSIONS.has(rawExt)) {
      return res.status(400).json({ error: `File type '.${rawExt}' is not allowed` });
    }

    // 🔒 SECURITY: Limiter la taille du fichier (10 MB max)
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
    if (file.size > MAX_FILE_SIZE) {
      return res.status(400).json({ error: "File too large (max 10 MB)" });
    }

    const ext = rawExt;
    const id = nanoid();
    
    // 🛡️ SÉCURITÉ : Path avec préfixe user pour ownership et isolation
    const path = `${userId}/${id}.${ext}`; // ex: user123/abcd1234.jpeg

    const { data, error } = await supabaseAdmin.storage
      .from("media")
      .upload(path, file.buffer, {
        contentType: file.mimetype,
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      console.error("[MEDIA] upload error:", error);
      return res.status(500).json({ error: "Could not upload file" });
    }

    const {
      data: { publicUrl },
    } = supabaseAdmin.storage.from("media").getPublicUrl(path);

    // 🛡️ SÉCURITÉ : Tracker l'upload dans la DB pour ownership
    const { error: dbError } = await supabaseAdmin
      .from("media_uploads")
      .insert({
        id,
        user_id: userId,
        storage_path: path,
        file_name: file.originalname,
        mime_type: file.mimetype,
        file_size: file.size,
        public_url: publicUrl,
      });

    if (dbError) {
      console.warn("[MEDIA] DB tracking failed (non-blocking):", dbError);
      // Non-bloquant : l'upload a réussi même si le tracking échoue
    }

    return res.status(201).json({
      id,
      url: publicUrl,
      mimeType: file.mimetype,
      size: file.size,
    });
  } catch (err) {
    console.error("[MEDIA] upload exception:", err);
    return res.status(500).json({ error: "Could not upload file" });
  }
}

export async function deleteMedia(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    if (!id) {
      return res.status(400).json({ error: "Missing id" });
    }

    // 🛡️ SÉCURITÉ : Vérifier ownership avant suppression
    const { data: upload, error: fetchError } = await supabaseAdmin
      .from("media_uploads")
      .select("storage_path, user_id")
      .eq("id", id)
      .maybeSingle();

    if (fetchError) {
      console.error("[MEDIA] ownership check error:", fetchError);
      return res.status(500).json({ error: "Could not verify ownership" });
    }

    if (!upload) {
      return res.status(404).json({ error: "Media not found" });
    }

    // 🛡️ SÉCURITÉ : Seul le propriétaire peut supprimer
    if (upload.user_id !== userId) {
      return res.status(403).json({ error: "Forbidden: you don't own this media" });
    }

    // Suppression du fichier dans Supabase Storage
    const { error: storageError } = await supabaseAdmin
      .storage
      .from("media")
      .remove([upload.storage_path]);

    if (storageError) {
      console.error("[MEDIA] storage delete error:", storageError);
      return res.status(500).json({ error: "Could not delete file from storage" });
    }

    // Suppression de l'entrée DB
    const { error: dbError } = await supabaseAdmin
      .from("media_uploads")
      .delete()
      .eq("id", id);

    if (dbError) {
      console.warn("[MEDIA] DB cleanup failed (non-blocking):", dbError);
      // Non-bloquant : le fichier est supprimé même si la DB échoue
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("[MEDIA] delete exception:", err);
    return res.status(500).json({ error: "Could not delete file" });
  }
}
