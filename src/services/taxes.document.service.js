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
  let html = fs.readFileSync(templatePath, "utf8");

  html = html
    .replaceAll("{{MONTH}}", month)
    .replaceAll("{{COUNT}}", String(summary.servicesCount))
    .replaceAll("{{REVENUE}}", String(summary.revenue))
    .replaceAll("{{COMMISSION}}", String(summary.commissions));

  return await htmlToPdf(html);
}
