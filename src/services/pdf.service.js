import puppeteer from "puppeteer";
import { install, getInstalledBrowsers } from "@puppeteer/browsers";

/**
 * 🟦 HTML TO PDF – Convertir du HTML en PDF
 * 
 * Utilise Puppeteer avec Chrome.
 * Sur Render, Chrome est installé automatiquement si nécessaire.
 */
export async function htmlToPdf(html) {
  let browser;
  
  try {
    // Configuration pour production (Render)
    const isProduction = process.env.NODE_ENV === "production" || process.env.RENDER;
    
    const launchOptions = {
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        "--disable-software-rasterizer",
      ],
    };

    // Sur Alpine (Dockerfile), utiliser le Chrome installé
    if (isProduction && process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      console.log(`🔧 [PDF] Using Chrome from: ${launchOptions.executablePath}`);
    }

    try {
      browser = await puppeteer.launch(launchOptions);
    } catch (error) {
      // Si Chrome n'est pas trouvé, essayer de l'installer automatiquement
      if (error.message.includes("Could not find Chrome") || error.message.includes("executable doesn't exist")) {
        console.log("📦 [PDF] Chrome not found, installing automatically...");
        
        const cacheDir = process.env.PUPPETEER_CACHE_DIR || "/opt/render/.cache/puppeteer";
        
        // Vérifier si Chrome est déjà installé
        const installedBrowsers = await getInstalledBrowsers({ cacheDir });
        
        if (installedBrowsers.length === 0) {
          console.log("📦 [PDF] Installing Chrome for Puppeteer...");
          await install({
            browser: "chrome",
            cacheDir,
          });
          console.log("✅ [PDF] Chrome installed successfully");
        } else {
          console.log("✅ [PDF] Chrome already installed");
        }
        
        // Réessayer avec le Chrome installé
        browser = await puppeteer.launch(launchOptions);
      } else {
        throw error;
      }
    }
    
    const page = await browser.newPage();

    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({ 
      format: "A4", 
      printBackground: true,
      margin: {
        top: "0.5cm",
        right: "0.5cm",
        bottom: "0.5cm",
        left: "0.5cm",
      },
    });

    await browser.close();
    return pdfBuffer;
  } catch (error) {
    console.error("❌ [PDF] Error generating PDF:", error);
    
    // Nettoyer le browser en cas d'erreur
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.error("❌ [PDF] Error closing browser:", closeError);
      }
    }
    
    throw new Error(`Failed to generate PDF: ${error.message}`);
  }
}
