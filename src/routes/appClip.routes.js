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
  let providerName = "NIOS";
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
    <title>${providerName} — NIOS</title>
    
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
  const domain = process.env.APP_CLIP_DOMAIN || "xn--nos-zma.com";
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

// ============================================================
// 4. RESET PASSWORD PAGE — /reset-password
//    Page web pour réinitialiser le mot de passe.
//    Supabase redirige ici après le clic dans l'email.
//    Récupère les tokens (hash fragments) côté client JS
//    et appelle Supabase pour mettre à jour le mot de passe.
// ============================================================
router.get("/reset-password", (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL || "";
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Nouveau mot de passe — NIOS</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;
            background: #f5f5f7;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .card {
            background: #fff;
            border-radius: 24px;
            padding: 40px 32px;
            max-width: 420px;
            width: 100%;
            box-shadow: 0 2px 40px rgba(0,0,0,0.06);
            text-align: center;
        }
        .logo {
            width: 64px;
            height: 64px;
            background: #000;
            color: #fff;
            border-radius: 16px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 26px;
            font-weight: 900;
            margin-bottom: 24px;
        }
        h1 {
            font-size: 24px;
            font-weight: 800;
            color: #000;
            margin-bottom: 6px;
        }
        .subtitle {
            font-size: 15px;
            color: #888;
            margin-bottom: 28px;
            line-height: 1.5;
        }
        .field {
            position: relative;
            margin-bottom: 14px;
            text-align: left;
        }
        .field label {
            display: block;
            font-size: 14px;
            font-weight: 600;
            color: #333;
            margin-bottom: 6px;
        }
        .field input {
            width: 100%;
            padding: 14px 16px;
            border: 1.5px solid #e0e0e0;
            border-radius: 14px;
            font-size: 16px;
            outline: none;
            transition: border-color 0.2s;
            background: #fafafa;
            color: #000;
        }
        .field input:focus {
            border-color: #000;
            background: #fff;
        }
        .requirements {
            font-size: 12px;
            color: #999;
            margin-top: 4px;
            text-align: left;
        }
        .btn {
            width: 100%;
            padding: 16px;
            background: #000;
            color: #fff;
            border: none;
            border-radius: 50px;
            font-size: 17px;
            font-weight: 700;
            cursor: pointer;
            margin-top: 10px;
            transition: transform 0.2s, opacity 0.2s;
        }
        .btn:hover { transform: scale(1.02); }
        .btn:disabled {
            opacity: 0.4;
            cursor: not-allowed;
            transform: none;
        }
        .error {
            background: #fff0f0;
            border: 1px solid #fcc;
            color: #c00;
            padding: 12px 16px;
            border-radius: 12px;
            font-size: 14px;
            margin-bottom: 16px;
            display: none;
        }
        .success-container {
            display: none;
        }
        .success-icon {
            width: 80px;
            height: 80px;
            background: linear-gradient(135deg, #e8f5e9, #c8e6c9);
            border-radius: 50%;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 20px;
        }
        .success-icon svg {
            width: 40px;
            height: 40px;
            fill: #2e7d32;
        }
        .success-title {
            font-size: 22px;
            font-weight: 800;
            color: #000;
            margin-bottom: 8px;
        }
        .success-text {
            font-size: 15px;
            color: #888;
            line-height: 1.5;
            margin-bottom: 24px;
        }
        .link {
            color: #000;
            font-weight: 600;
            text-decoration: none;
        }
        .link:hover { text-decoration: underline; }
        .expired-container {
            display: none;
        }
        .expired-icon {
            width: 80px;
            height: 80px;
            background: linear-gradient(135deg, #fff3e0, #ffe0b2);
            border-radius: 50%;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 20px;
        }
        .expired-icon svg {
            width: 40px;
            height: 40px;
            fill: #e65100;
        }
        .spinner {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 2.5px solid #fff;
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 0.6s linear infinite;
            vertical-align: middle;
            margin-right: 8px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div class="card">
        <div class="logo">N</div>

        <!-- FORM -->
        <div id="form-container">
            <h1>Nouveau mot de passe</h1>
            <p class="subtitle">Choisissez un mot de passe sécurisé pour votre compte NIOS.</p>

            <div id="error-box" class="error"></div>

            <div class="field">
                <label for="password">Nouveau mot de passe</label>
                <input type="password" id="password" placeholder="••••••••" autocomplete="new-password" />
                <p class="requirements">Minimum 6 caractères</p>
            </div>

            <div class="field">
                <label for="confirm">Confirmer le mot de passe</label>
                <input type="password" id="confirm" placeholder="••••••••" autocomplete="new-password" />
            </div>

            <button class="btn" id="submit-btn" disabled onclick="resetPassword()">
                Réinitialiser le mot de passe
            </button>
        </div>

        <!-- SUCCESS -->
        <div id="success-container" class="success-container">
            <div class="success-icon">
                <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
            </div>
            <p class="success-title">Mot de passe mis à jour</p>
            <p class="success-text">
                Votre mot de passe a été modifié avec succès.<br/>
                Vous pouvez maintenant vous connecter dans l'app NIOS.
            </p>
            <button class="btn" onclick="openApp()">Ouvrir l'app NIOS</button>
        </div>

        <!-- EXPIRED / ERROR -->
        <div id="expired-container" class="expired-container">
            <div class="expired-icon">
                <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
            </div>
            <p class="success-title">Lien expiré</p>
            <p class="success-text">
                Ce lien de réinitialisation n'est plus valide.<br/>
                Veuillez demander un nouveau lien depuis l'app.
            </p>
        </div>
    </div>

    <script>
        const SUPABASE_URL = "${supabaseUrl}";
        const SUPABASE_ANON_KEY = "${supabaseAnonKey}";

        let accessToken = null;

        // Supabase envoie les tokens dans le hash fragment
        // Format: #access_token=xxx&refresh_token=xxx&type=recovery
        (function init() {
            const hash = window.location.hash.substring(1);
            const params = new URLSearchParams(hash);

            accessToken = params.get("access_token");
            const type = params.get("type");

            if (!accessToken || type !== "recovery") {
                // Pas de token recovery = lien invalide ou expiré
                document.getElementById("form-container").style.display = "none";
                document.getElementById("expired-container").style.display = "block";
                return;
            }

            // Activer le formulaire
            const pwInput = document.getElementById("password");
            const cfInput = document.getElementById("confirm");
            const btn = document.getElementById("submit-btn");

            function validate() {
                const pw = pwInput.value;
                const cf = cfInput.value;
                btn.disabled = pw.length < 6 || pw !== cf;
            }

            pwInput.addEventListener("input", validate);
            cfInput.addEventListener("input", validate);
        })();

        async function resetPassword() {
            const pw = document.getElementById("password").value;
            const cf = document.getElementById("confirm").value;
            const btn = document.getElementById("submit-btn");
            const errBox = document.getElementById("error-box");

            errBox.style.display = "none";

            if (pw.length < 6) {
                errBox.textContent = "Le mot de passe doit contenir au moins 6 caractères.";
                errBox.style.display = "block";
                return;
            }

            if (pw !== cf) {
                errBox.textContent = "Les mots de passe ne correspondent pas.";
                errBox.style.display = "block";
                return;
            }

            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span>Modification...';

            try {
                const res = await fetch(SUPABASE_URL + "/auth/v1/user", {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json",
                        "apikey": SUPABASE_ANON_KEY,
                        "Authorization": "Bearer " + accessToken,
                    },
                    body: JSON.stringify({ password: pw }),
                });

                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    throw new Error(data.msg || data.error_description || "Erreur lors de la mise à jour");
                }

                // Succès
                document.getElementById("form-container").style.display = "none";
                document.getElementById("success-container").style.display = "block";

            } catch (err) {
                errBox.textContent = err.message || "Une erreur est survenue. Le lien est peut-être expiré.";
                errBox.style.display = "block";
                btn.disabled = false;
                btn.textContent = "Réinitialiser le mot de passe";
            }
        }

        function openApp() {
            // Essayer d'ouvrir l'app via deep link
            window.location.href = "nios://login";
            // Fallback App Store après 1.5s
            setTimeout(function() {
                window.location.href = "${process.env.APP_STORE_URL || "https://apps.apple.com/app/id0000000000"}";
            }, 1500);
        }
    </script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(html);
});

export default router;
