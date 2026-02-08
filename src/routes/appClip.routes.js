// src/routes/appClip.routes.js
// Routes pour supporter l'App Clip iOS :
//  1. Apple App Site Association (AASA) file
//  2. Page de redirection QR → App Clip / App Store
//  3. Génération de QR codes pour les providers

import { Router } from "express";
import { supabaseAdmin as supabase } from "../config/supabase.js";

const router = Router();

// ============================================================
// 1. AASA — /.well-known/apple-app-site-association
//    Doit être servi sans Content-Type header text/html
//    Apple le récupère automatiquement pour valider les URLs
// ============================================================
router.get("/.well-known/apple-app-site-association", (req, res) => {
  const appID = process.env.APPLE_TEAM_ID
    ? `${process.env.APPLE_TEAM_ID}.com.Cleanny.BelDetailing`
    : "XXXXXXXXXX.com.Cleanny.BelDetailing"; // ⚠️ Remplacer XXXXXXXXXX par ton Team ID

  const clipBundleID = process.env.APPLE_TEAM_ID
    ? `${process.env.APPLE_TEAM_ID}.com.Cleanny.BelDetailing.Clip`
    : "XXXXXXXXXX.com.Cleanny.BelDetailing.Clip";

  const aasa = {
    applinks: {
      apps: [],
      details: [
        {
          appID: appID,
          paths: ["/clip/*", "/provider/*", "/invite/*"],
        },
      ],
    },
    appclips: {
      apps: [clipBundleID],
    },
  };

  res.setHeader("Content-Type", "application/json");
  return res.json(aasa);
});

// ============================================================
// 2. CLIP LANDING — /clip/:providerId
//    Quand un navigateur (pas iOS) scanne le QR code,
//    on affiche une page web de redirection vers l'App Store.
//    Sur iOS avec App Clip, le système intercepte automatiquement.
// ============================================================
router.get("/clip/:providerId", async (req, res) => {
  const { providerId } = req.params;

  // Tenter de charger les infos du provider pour afficher son nom
  let providerName = "BelDetailing";
  let providerCity = "";

  try {
    const { data } = await supabase
      .from("provider_profiles")
      .select("display_name, base_city")
      .or(`user_id.eq.${providerId},id.eq.${providerId}`)
      .maybeSingle();

    if (data) {
      providerName = data.display_name || providerName;
      providerCity = data.base_city || "";
    }
  } catch (err) {
    console.warn("[APP CLIP] Provider lookup failed:", err.message);
  }

  // App Store URL (remplacer par l'ID réel une fois publié)
  const appStoreUrl =
    process.env.APP_STORE_URL || "https://apps.apple.com/app/id0000000000";

  // Page HTML de fallback (pour navigateurs non-iOS)
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${providerName} — BelDetailing</title>
    
    <!-- Apple App Clip Meta Tags -->
    <meta name="apple-itunes-app" 
          content="app-clip-bundle-id=com.Cleanny.BelDetailing.Clip, 
                   app-id=0000000000,
                   app-clip-display=card">
    
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #000;
            color: #fff;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 24px;
        }
        .container {
            text-align: center;
            max-width: 380px;
        }
        .logo {
            width: 80px;
            height: 80px;
            background: #fff;
            border-radius: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 24px;
            font-size: 32px;
            font-weight: 900;
            color: #000;
        }
        h1 {
            font-size: 28px;
            font-weight: 800;
            margin-bottom: 8px;
        }
        .city {
            font-size: 16px;
            color: rgba(255,255,255,0.6);
            margin-bottom: 32px;
        }
        .cta {
            display: inline-block;
            background: #fff;
            color: #000;
            font-size: 17px;
            font-weight: 700;
            padding: 14px 40px;
            border-radius: 50px;
            text-decoration: none;
            transition: transform 0.2s;
        }
        .cta:hover { transform: scale(1.05); }
        .subtitle {
            margin-top: 20px;
            font-size: 14px;
            color: rgba(255,255,255,0.5);
        }
        .badge {
            display: inline-block;
            background: rgba(255,255,255,0.1);
            padding: 6px 14px;
            border-radius: 20px;
            font-size: 13px;
            margin-top: 12px;
            color: rgba(255,255,255,0.7);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">N</div>
        <h1>${providerName}</h1>
        ${providerCity ? `<p class="city">📍 ${providerCity}</p>` : ""}
        <a href="${appStoreUrl}" class="cta">
            Télécharger NIOS
        </a>
        <p class="subtitle">
            Réservez votre detailing auto en quelques taps
        </p>
        <span class="badge">✨ Scan → Réserve → C'est prêt</span>
    </div>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(html);
});

// ============================================================
// 3. QR CODE DATA — /api/v1/app-clip/qr/:providerId
//    Retourne les données nécessaires pour générer un QR code
//    Le provider peut l'afficher dans son dashboard
// ============================================================
router.get("/api/v1/app-clip/qr/:providerId", async (req, res) => {
  const { providerId } = req.params;

  // Domaine principal (configurable via env)
  const domain = process.env.APP_CLIP_DOMAIN || "nios.app";
  const clipUrl = `https://${domain}/clip/${providerId}`;

  try {
    // Vérifier que le provider existe
    const { data: provider } = await supabase
      .from("provider_profiles")
      .select("display_name, base_city, logo_url")
      .or(`user_id.eq.${providerId},id.eq.${providerId}`)
      .maybeSingle();

    if (!provider) {
      return res.status(404).json({ error: "Provider not found" });
    }

    return res.json({
      url: clipUrl,
      providerName: provider.display_name,
      providerCity: provider.base_city,
      providerLogoUrl: provider.logo_url,
      instructions: {
        fr: "Scannez ce QR code pour réserver directement chez ce detailer, sans installer l'app.",
        nl: "Scan deze QR-code om rechtstreeks bij deze detailer te reserveren, zonder de app te installeren.",
        en: "Scan this QR code to book directly with this detailer, without installing the app.",
      },
    });
  } catch (err) {
    console.error("[APP CLIP] QR data error:", err);
    return res.status(500).json({ error: "Could not generate QR data" });
  }
});

export default router;
