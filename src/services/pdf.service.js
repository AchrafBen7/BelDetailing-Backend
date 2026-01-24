import puppeteer from "puppeteer";
import PDFDocument from "pdfkit";

/**
 * 🟦 HTML TO PDF – Convertir du HTML en PDF
 * 
 * Essaie d'abord Puppeteer, puis utilise pdfkit en fallback si Chrome n'est pas disponible.
 */
export async function htmlToPdf(html) {
  // Essayer Puppeteer d'abord
  try {
    return await htmlToPdfWithPuppeteer(html);
  } catch (error) {
    console.warn("⚠️ [PDF] Puppeteer failed, using pdfkit fallback:", error.message);
    // Fallback vers pdfkit si Puppeteer échoue
    return await htmlToPdfWithPdfKit(html);
  }
}

/**
 * 🟦 HTML TO PDF WITH PUPPETEER – Utilise Puppeteer (nécessite Chrome)
 */
async function htmlToPdfWithPuppeteer(html) {
  let browser;
  
  try {
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

    if (isProduction && process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      console.log(`🔧 [PDF] Using system Chrome from: ${launchOptions.executablePath}`);
    } else {
      console.log(`🔧 [PDF] Using Puppeteer's bundled Chrome`);
    }

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
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        // Ignore
      }
    }
    throw error;
  }
}

/**
 * 🟦 HTML TO PDF WITH PDFKIT – Fallback utilisant pdfkit (pas de Chrome nécessaire)
 * 
 * Note: pdfkit ne peut pas parser le HTML directement, donc on extrait le texte principal.
 * Pour un rendu complet, il faudrait parser le HTML ou utiliser les données brutes.
 */
async function htmlToPdfWithPdfKit(html) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks = [];

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // Extraire le texte principal du HTML (simple extraction)
      const textContent = extractTextFromHtml(html);

      // Générer le PDF avec pdfkit
      doc.fontSize(20).text("Mission Agreement", { align: "center" });
      doc.moveDown();
      doc.fontSize(12);
      
      // Diviser le texte en lignes et les ajouter
      const lines = textContent.split("\n").filter(line => line.trim().length > 0);
      lines.forEach((line) => {
        if (doc.y > 750) { // Nouvelle page si nécessaire
          doc.addPage();
        }
        doc.text(line.trim(), { align: "left" });
        doc.moveDown(0.5);
      });

      doc.end();
    } catch (error) {
      reject(new Error(`Failed to generate PDF with pdfkit: ${error.message}`));
    }
  });
}

/**
 * 🟦 EXTRACT TEXT FROM HTML – Extraire le texte principal du HTML
 */
function extractTextFromHtml(html) {
  // Supprimer les balises HTML et extraire le texte
  let text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "") // Supprimer les scripts
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "") // Supprimer les styles
    .replace(/<[^>]+>/g, "\n") // Remplacer les balises par des sauts de ligne
    .replace(/\n\s*\n\s*\n/g, "\n\n") // Nettoyer les sauts de ligne multiples
    .trim();

  // Décoder les entités HTML
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  return text;
}
