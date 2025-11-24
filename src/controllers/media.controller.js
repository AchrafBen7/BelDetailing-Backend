// src/controllers/media.controller.js
import { supabaseAdmin } from "../config/supabase.js";
import { nanoid } from "nanoid";

export async function uploadMedia(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file provided" });
    }

    const file = req.file;
    const ext = file.originalname.split(".").pop();
    const id = nanoid();
    const path = `${id}.${ext}`; // ex: abcd1234.jpeg

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
    if (!id) {
      return res.status(400).json({ error: "Missing id" });
    }

    const { error } = await supabaseAdmin
      .storage
      .from("media")
      .remove([id]);            // on supprime le fichier "id.ext"

    if (error) {
      console.error("[MEDIA] delete error:", error);
      return res.status(500).json({ error: "Could not delete file" });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("[MEDIA] delete exception:", err);
    return res.status(500).json({ error: "Could not delete file" });
  }
}
