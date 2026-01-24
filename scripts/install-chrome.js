// scripts/install-chrome.js
// Script pour installer Chrome pour Puppeteer sur Render

import { install } from "@puppeteer/browsers";

(async () => {
  const isProduction = process.env.NODE_ENV === "production" || process.env.RENDER;

  if (isProduction) {
    console.log("📦 [POSTINSTALL] Installing Chrome for Puppeteer...");
    
    const cacheDir = process.env.PUPPETEER_CACHE_DIR || "/opt/render/.cache/puppeteer";
    
    try {
      await install({
        browser: "chrome",
        cacheDir,
      });
      console.log("✅ [POSTINSTALL] Chrome installed successfully");
    } catch (error) {
      console.warn("⚠️ [POSTINSTALL] Chrome installation failed (will be installed on first use):", error.message);
      // Ne pas faire échouer l'installation si Chrome ne peut pas être installé maintenant
      // Il sera installé automatiquement lors du premier appel à htmlToPdf
      process.exit(0); // Sortir avec succès pour ne pas bloquer npm install
    }
  } else {
    console.log("ℹ️ [POSTINSTALL] Skipping Chrome installation (development mode)");
  }
})();
