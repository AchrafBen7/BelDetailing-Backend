import { htmlToPdf } from "./pdf.service.js";
import fs from "fs";
import path from "path";
import { computeMonthlySummary } from "./taxes.service.js";

export async function generateDocumentPDF(providerUserId, documentId) {
  // documentId example: "2024-12-beldetailing"
  const parts = documentId.split("-");
  const month = `${parts[0]}-${parts[1]}`; // "2024-12"
  const type = parts.slice(2).join("-");   // "beldetailing" (ou stripe)

  const summary = await computeMonthlySummary(providerUserId, month);

  // chemin solide vers le template
  const templatePath = path.join(process.cwd(), "src", "templates", "taxes", "taxes-invoice.html");
  
  // ✅ Utiliser readFile avec try-catch pour éviter les timeouts
  let html;
  try {
    html = fs.readFileSync(templatePath, "utf8");
  } catch (err) {
    console.error("[TAXES] Error reading template:", err);
    // Fallback: générer un HTML minimal
    html = `
      <html>
        <body>
          <h1>Facture BelDetailing</h1>
          <p>Période: ${month}</p>
          <p>Services: ${summary.servicesCount}</p>
          <p>Revenus: ${summary.revenue}€</p>
          <p>Commission: ${summary.commissions}€</p>
        </body>
      </html>
    `;
  }

  const netAmount = summary.revenue - summary.commissions;
  
  html = html
    .replaceAll("{{MONTH}}", month)
    .replaceAll("{{COUNT}}", String(summary.servicesCount))
    .replaceAll("{{REVENUE}}", String(summary.revenue))
    .replaceAll("{{COMMISSION}}", String(summary.commissions))
    .replaceAll("{{NET}}", String(netAmount.toFixed(2)));

  return await htmlToPdf(html);
}
