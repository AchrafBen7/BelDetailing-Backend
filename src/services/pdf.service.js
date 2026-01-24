import puppeteer from "puppeteer";

/**
 * 🟦 HTML TO PDF – Convertir du HTML en PDF
 * 
 * Utilise Puppeteer avec Chrome.
 * Puppeteer inclut Chrome par défaut, mais sur Render, on peut utiliser le Chrome système si disponible.
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
      console.log(`🔧 [PDF] Using system Chrome from: ${launchOptions.executablePath}`);
    } else {
      // Utiliser le Chrome fourni par Puppeteer (inclus dans le package)
      console.log(`🔧 [PDF] Using Puppeteer's bundled Chrome`);
    }

    // Lancer Puppeteer (utilise le Chrome fourni par défaut si executablePath n'est pas défini)
    browser = await puppeteer.launch(launchOptions);
    
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
