// src/services/missionAgreementPdfPdfKit.service.js
// Génération du PDF : CONVENTION DE COLLABORATION INDÉPENDANTE (structure juridique, non facture)

import PDFDocument from "pdfkit";
import { getMissionAgreementById } from "./missionAgreement.service.js";
import { getMissionPaymentsForAgreement } from "./missionPayment.service.js";
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { MISSION_COMMISSION_RATE } from "../config/commission.js";

/**
 * Convertit les règles opérationnelles (JSON) en texte explicite pour l'Article 5.
 * Chaque règle ajoutée par la company est écrite en clair dans le contrat.
 */
function operationalRulesToArticle5Paragraphs(rules) {
  if (!rules || typeof rules !== "object") return [];

  const paragraphs = [];
  const labels = {
    locationType: "Type de mission",
    on_site: "Sur site (chez la company)",
    mobile: "Mobile (le prestataire se déplace)",
    workshop: "Dans l'atelier du prestataire",
    fixedAddress: "Adresse fixe d'intervention",
    variableAddresses: "Adresses variables",
    siteAccess: "Accès au site",
    guaranteed: "Accès au site garanti par le donneur d'ordre",
    parkingAvailable: "Parking disponible",
    secureZoneRequired: "Zone sécurisée requise",
    workingHours: "Horaires",
    fixed: "Horaires imposés",
    flexible: "Horaires flexibles",
    startTime: "Heure de début",
    endTime: "Heure de fin",
    allowedDays: "Jours autorisés",
    weekdays: "Jours de semaine",
    weekend: "Week-end",
    holidays: "Jours fériés",
    maxDelayMinutes: "Délai maximum de retard autorisé (minutes)",
    delayNotificationRequired: "Notification obligatoire en cas de retard",
    equipmentProvider: "Fournisseur de matériel",
    company: "Le donneur d'ordre",
    detailer: "Le prestataire",
    mixed: "Mixte (donneur d'ordre et prestataire)",
    productsPolicy: "Politique produits",
    imposed: "Produits imposés par le donneur d'ordre",
    free: "Produits libres (au choix du prestataire)",
    waterProvided: "Eau fournie par le donneur d'ordre",
    electricityProvided: "Électricité fournie par le donneur d'ordre",
    vehicleTolerance: "Tolérance sur le volume (%)",
    vehicleTypes: "Types de véhicules concernés",
    city: "Citadine",
    suv: "SUV",
    utility: "Utilitaire",
    premium: "Premium",
    extremeConditionNotification: "État extrême des véhicules à signaler à l'avance",
    photosRequired: "Preuves photographiques",
    before: "Photos AVANT obligatoires",
    after: "Photos APRÈS obligatoires",
    validationRequired: "Validation",
    daily: "Validation quotidienne requise",
    final: "Validation finale requise",
    validationBy: "Validation effectuée par",
    on_site_manager: "Responsable sur place",
    remote_manager: "Manager à distance",
    nios: "NIOS (en cas de litige)",
    missionReportRequired: "Rapport de mission requis",
    damageReporting: "Signalement de dommage",
    required: "Signalement obligatoire en cas de dommage",
    deadlineHours: "Déclaration sous X heures",
    insuranceRequired: "Assurance professionnelle requise",
    companyResponsibility: "Responsabilités du donneur d'ordre",
    disputeProcedureAccepted: "Procédure de litige NIOS acceptée",
    depositRelease: "Déblocage de l'acompte",
    mission_start: "Au début de la mission",
    first_validation: "Après première validation",
    specific_date: "À une date précise",
    finalPaymentTrigger: "Déclenchement du paiement final",
    final_validation: "À validation finale",
    fixed_date: "À date fixe",
    auto_if_no_objection: "Automatiquement en l'absence d'objection",
    autoSuspendOnPaymentFailure: "Suspension automatique en cas d'échec de paiement",
    autoInvoice: "Facture générée automatiquement",
    monthlyInvoice: "Facture mensuelle (mission longue)",
    uniqueOrderNumber: "Numéro de commande unique",
    legalArchive: "Archivage légal des documents",
    cancellationPolicy: "Conditions d'annulation",
    dateModificationAllowed: "Modification des dates possible avant validation",
    dateModificationAfterStart: "Modification des dates interdite après le début",
    earlyTerminationPolicy: "Rupture anticipée",
  };

  const formatVal = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === "boolean") return v ? "Oui" : "Non";
    if (typeof v === "string" && labels[v]) return labels[v];
    if (typeof v === "object" && v !== null) {
      if (Array.isArray(v)) return v.map((item) => labels[item] || formatVal(item)).join(", ");
      return Object.entries(v)
        .filter(([, val]) => val !== null && val !== undefined)
        .map(([k, val]) => `${labels[k] || k} : ${typeof val === "boolean" ? (val ? "Oui" : "Non") : labels[val] || formatVal(val)}`)
        .join(" ; ");
    }
    return String(v);
  };

  const sections = [
    {
      title: "A. Présence et lieu",
      keys: ["locationType", "fixedAddress", "variableAddresses", "siteAccess"],
    },
    {
      title: "B. Dates et horaires",
      keys: ["workingHours", "allowedDays", "maxDelayMinutes", "delayNotificationRequired"],
    },
    {
      title: "C. Matériel et produits",
      keys: ["equipmentProvider", "productsPolicy", "waterProvided", "electricityProvided"],
    },
    {
      title: "D. Véhicules et volume",
      keys: ["vehicleTolerance", "vehicleTypes", "extremeConditionNotification"],
    },
    {
      title: "E. Preuves et validation",
      keys: ["photosRequired", "validationRequired", "validationBy", "missionReportRequired"],
    },
    {
      title: "G. Incidents et responsabilités",
      keys: ["damageReporting", "insuranceRequired", "companyResponsibility", "disputeProcedureAccepted"],
    },
    {
      title: "H. Paiement et déclenchement",
      keys: ["depositRelease", "finalPaymentTrigger", "autoSuspendOnPaymentFailure"],
    },
    {
      title: "I. Facturation et administration",
      keys: ["autoInvoice", "monthlyInvoice", "uniqueOrderNumber", "legalArchive"],
    },
    {
      title: "J. Annulation et modification",
      keys: ["cancellationPolicy", "dateModificationAllowed", "dateModificationAfterStart", "earlyTerminationPolicy"],
    },
  ];

  for (const section of sections) {
    const lines = [];
    for (const key of section.keys) {
      const raw = rules[key];
      if (raw === null || raw === undefined) continue;
      const label = labels[key] || key;
      const text = formatVal(raw);
      if (text) lines.push(`• ${label} : ${text}`);
    }
    if (lines.length > 0) {
      paragraphs.push({ title: section.title, lines });
    }
  }

  // Règles libres (clés non mappées)
  const knownKeys = new Set(sections.flatMap((s) => s.keys));
  for (const [key, value] of Object.entries(rules)) {
    if (knownKeys.has(key)) continue;
    const text = formatVal(value);
    if (text) paragraphs.push({ title: null, lines: [`• ${key} : ${text}`] });
  }

  return paragraphs;
}

/**
 * Génère le PDF de la CONVENTION DE COLLABORATION INDÉPENDANTE.
 * Structure juridique conventionnelle (pas une facture).
 *
 * @param {string} missionAgreementId - ID du Mission Agreement
 * @returns {Promise<Buffer>} Buffer du PDF généré
 */
export async function generateMissionAgreementPdfWithPdfKit(missionAgreementId) {
  const agreement = await getMissionAgreementById(missionAgreementId);
  if (!agreement) throw new Error("Mission Agreement not found");

  const { data: companyUser } = await supabase
    .from("users")
    .select("email, phone")
    .eq("id", agreement.companyId)
    .single();

  const { data: companyProfile } = await supabase
    .from("company_profiles")
    .select("legal_name, city, postal_code, contact_name")
    .eq("user_id", agreement.companyId)
    .maybeSingle();

  const { data: detailerUser } = await supabase
    .from("users")
    .select("email, phone")
    .eq("id", agreement.detailerId)
    .single();

  const { data: detailerProfile } = await supabase
    .from("provider_profiles")
    .select("display_name, base_city, postal_code, phone, email")
    .eq("user_id", agreement.detailerId)
    .maybeSingle();

  const payments = await getMissionPaymentsForAgreement(missionAgreementId);

  const totalAmount = agreement.finalPrice || 0;
  const depositAmount = agreement.depositAmount || 0;
  const remainingAmount = agreement.remainingAmount || 0;
  const commissionAmount = Math.round(totalAmount * MISSION_COMMISSION_RATE * 100) / 100;
  const netAmount = Math.round((totalAmount - commissionAmount) * 100) / 100;

  const formatDate = (dateString) => {
    if (!dateString) return "Non défini";
    return new Date(dateString).toLocaleDateString("fr-BE", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const companyName = agreement.companyLegalName || companyProfile?.legal_name || companyUser?.email || "—";
  const companyAddress = agreement.companyAddress || [companyProfile?.city, companyProfile?.postal_code].filter(Boolean).join(" ") || "—";
  const companyRep = agreement.companyLegalRepresentative || companyProfile?.contact_name || "—";
  const companyVat = agreement.companyVatNumber || "—";
  const companyEmail = agreement.companyEmail || companyUser?.email || "—";

  const detailerName = agreement.detailerLegalName || detailerProfile?.display_name || detailerUser?.email || "—";
  const detailerAddress = agreement.detailerAddress || [detailerProfile?.base_city, detailerProfile?.postal_code].filter(Boolean).join(" ") || "—";
  const detailerVat = agreement.detailerVatNumber || "—";
  const detailerEmail = agreement.detailerEmail || detailerProfile?.email || detailerUser?.email || "—";

  const operationalParagraphs = operationalRulesToArticle5Paragraphs(agreement.operationalRules);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50, autoFirstPage: true });
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const pageMargin = 50;
      const pageWidth = 595 - pageMargin * 2;
      const maxY = 842 - pageMargin;

      const checkPageBreak = (required = 60) => {
        if (doc.y + required > maxY) {
          doc.addPage();
          doc.y = pageMargin;
        }
      };

      const drawHr = (y, w = pageWidth) => {
        doc.moveTo(pageMargin, y).lineTo(pageMargin + w, y).strokeColor("#000").lineWidth(0.5).stroke();
      };

      const small = () => doc.fontSize(9).font("Helvetica");
      const normal = () => doc.fontSize(10).font("Helvetica");
      const bold = () => doc.fontSize(10).font("Helvetica-Bold");
      const title = () => doc.fontSize(14).font("Helvetica-Bold");

      // ——— TITRE ———
      doc.fontSize(16).font("Helvetica-Bold").fillColor("#000");
      doc.text("CONVENTION DE COLLABORATION INDÉPENDANTE", pageMargin, 50, { width: pageWidth, align: "center" });
      doc.moveDown(0.5);
      small().fillColor("#333");
      doc.text(`Référence contrat : ${agreement.id}`, pageMargin, doc.y, { width: pageWidth, align: "center" });
      doc.y += 24;
      drawHr(doc.y);
      doc.moveDown(1);

      // ——— PRÉAMBULE : ENTRE LES SOUSSIGNÉS ———
      title().fillColor("#000");
      doc.text("Entre les soussignés :", pageMargin, doc.y);
      doc.moveDown(0.8);

      bold().text("D’une part, le DONNEUR D’ORDRE :", pageMargin, doc.y);
      doc.moveDown(0.4);
      normal();
      doc.text(`${companyName}`, pageMargin, doc.y);
      doc.text(`Représenté par : ${companyRep}`, pageMargin, doc.y + 14);
      doc.text(`Siège : ${companyAddress}`, pageMargin, doc.y + 28);
      doc.text(`N° TVA : ${companyVat}`, pageMargin, doc.y + 42);
      doc.text(`Courriel : ${companyEmail}`, pageMargin, doc.y + 56);
      doc.y += 70;
      checkPageBreak(80);

      bold().text("D’autre part, le PRESTATAIRE INDÉPENDANT :", pageMargin, doc.y);
      doc.moveDown(0.4);
      normal();
      doc.text(`${detailerName}`, pageMargin, doc.y);
      doc.text(`Adresse : ${detailerAddress}`, pageMargin, doc.y + 14);
      doc.text(`N° TVA : ${detailerVat}`, pageMargin, doc.y + 28);
      doc.text(`Courriel : ${detailerEmail}`, pageMargin, doc.y + 42);
      doc.y += 58;
      doc.moveDown(0.5);

      doc.text("Il a été convenu ce qui suit :", pageMargin, doc.y);
      doc.moveDown(1.2);

      // ——— ARTICLE 1 – OBJET ———
      checkPageBreak(120);
      title().text("Article 1 – Objet", pageMargin, doc.y);
      doc.moveDown(0.4);
      drawHr(doc.y);
      doc.moveDown(0.5);
      normal();
      doc.text("La présente convention a pour objet de définir les conditions dans lesquelles le Prestataire s’engage à exécuter, à titre indépendant, la mission décrite ci-après pour le compte du Donneur d’ordre.", pageMargin, doc.y, { width: pageWidth });
      doc.moveDown(0.6);
      bold().text("Mission :", pageMargin, doc.y);
      doc.moveDown(0.2);
      normal().text(agreement.title || "Mission", pageMargin, doc.y, { width: pageWidth });
      doc.moveDown(0.4);
      if (agreement.description) {
        doc.text(agreement.description, pageMargin, doc.y, { width: pageWidth });
        doc.moveDown(0.4);
      }
      doc.text(`Type de mission : ${agreement.missionType === "one-time" ? "Ponctuelle" : agreement.missionType === "recurring" ? "Récurrente" : "Long terme"}.`, pageMargin, doc.y, { width: pageWidth });
      doc.text(`Nombre de véhicules concernés : ${agreement.vehicleCount ?? 0}.`, pageMargin, doc.y + 14, { width: pageWidth });
      if (agreement.categories && agreement.categories.length) {
        doc.text(`Catégories : ${agreement.categories.join(", ")}.`, pageMargin, doc.y + 28, { width: pageWidth });
        doc.y += 14;
      }
      doc.y += 36;
      doc.moveDown(0.5);

      // ——— ARTICLE 2 – DURÉE ———
      checkPageBreak(80);
      title().text("Article 2 – Durée", pageMargin, doc.y);
      doc.moveDown(0.4);
      drawHr(doc.y);
      doc.moveDown(0.5);
      normal();
      doc.text(`La mission s’étend du ${agreement.startDate ? formatDate(agreement.startDate) : "à définir"} au ${agreement.endDate ? formatDate(agreement.endDate) : "à définir"}.`, pageMargin, doc.y, { width: pageWidth });
      if (agreement.estimatedDurationDays) {
        doc.text(`Durée estimée : ${agreement.estimatedDurationDays} jours.`, pageMargin, doc.y + 14, { width: pageWidth });
        doc.y += 14;
      }
      doc.y += 28;
      doc.moveDown(0.5);

      // ——— ARTICLE 3 – LIEU D'EXÉCUTION ———
      checkPageBreak(70);
      title().text("Article 3 – Lieu d’exécution", pageMargin, doc.y);
      doc.moveDown(0.4);
      drawHr(doc.y);
      doc.moveDown(0.5);
      normal();
      const lieu = agreement.exactAddress || `${agreement.locationCity || ""} ${agreement.locationPostalCode || ""}`.trim() || "À préciser";
      doc.text(`Lieu d’exécution : ${lieu}.`, pageMargin, doc.y, { width: pageWidth });
      if (agreement.specificConstraints) {
        doc.moveDown(0.4);
        doc.text(`Contraintes particulières : ${agreement.specificConstraints}`, pageMargin, doc.y, { width: pageWidth });
        doc.y += 14;
      }
      doc.y += 28;
      doc.moveDown(0.5);

      // ——— ARTICLE 4 – PRIX ET CONDITIONS FINANCIÈRES ———
      checkPageBreak(180);
      title().text("Article 4 – Prix et conditions financières", pageMargin, doc.y);
      doc.moveDown(0.4);
      drawHr(doc.y);
      doc.moveDown(0.5);
      normal();
      doc.text(`Le montant total de la mission est fixé à ${totalAmount.toFixed(2)} € (HT ou TVA selon applicabilité).`, pageMargin, doc.y, { width: pageWidth });
      doc.moveDown(0.4);
      doc.text(`Un acompte de ${agreement.depositPercentage ?? 0} %, soit ${depositAmount.toFixed(2)} €, est dû au début de la mission. Le solde restant, soit ${remainingAmount.toFixed(2)} €, est réglé selon l’échéancier convenu et détaillé en annexe ou via la plateforme NIOS.`, pageMargin, doc.y, { width: pageWidth });
      doc.moveDown(0.6);
      bold().text("Échéancier des paiements :", pageMargin, doc.y);
      doc.moveDown(0.3);
      if (payments && payments.length > 0) {
        const typeLabels = { deposit: "Acompte", installment: "Échéance", final: "Solde final", monthly: "Mensuel" };
        payments.forEach((p) => {
          const label = typeLabels[p.type] || p.type;
          const date = p.scheduledDate ? formatDate(p.scheduledDate) : "—";
          doc.text(`• ${label} : ${(p.amount || 0).toFixed(2)} € — ${date}`, pageMargin, doc.y, { width: pageWidth });
          doc.y += 14;
        });
      } else {
        doc.text("Acompte à la date de début ; solde à la fin de la mission ou selon plan de paiement NIOS.", pageMargin, doc.y, { width: pageWidth });
        doc.y += 14;
      }
      doc.y += 14;
      doc.moveDown(0.5);

      // ——— ARTICLE 5 – RÈGLES CONVENTIONNELLES ———
      checkPageBreak(100);
      title().text("Article 5 – Règles conventionnelles", pageMargin, doc.y);
      doc.moveDown(0.4);
      drawHr(doc.y);
      doc.moveDown(0.5);
      normal();
      doc.text("Les règles suivantes, définies par le Donneur d’ordre et acceptées par le Prestataire, s’appliquent à l’exécution de la mission :", pageMargin, doc.y, { width: pageWidth });
      doc.moveDown(0.6);

      if (operationalParagraphs.length > 0) {
        operationalParagraphs.forEach((block) => {
          checkPageBreak(30);
          if (block.title) {
            bold().text(block.title, pageMargin, doc.y);
            doc.y += 14;
          }
          block.lines.forEach((line) => {
            checkPageBreak(18);
            normal().text(line, pageMargin + 8, doc.y, { width: pageWidth - 8 });
            doc.y += 14;
          });
          doc.y += 8;
        });
      } else {
        doc.text("Aucune règle opérationnelle supplémentaire n’a été ajoutée pour la présente mission.", pageMargin, doc.y, { width: pageWidth });
        doc.y += 20;
      }
      doc.moveDown(0.5);

      // ——— ARTICLE 6 – COMMISSION PLATEFORME ———
      checkPageBreak(90);
      title().text("Article 6 – Commission plateforme NIOS", pageMargin, doc.y);
      doc.moveDown(0.4);
      drawHr(doc.y);
      doc.moveDown(0.5);
      normal();
      doc.text(`La plateforme NIOS prélève une commission de ${(MISSION_COMMISSION_RATE * 100).toFixed(0)} % sur le montant de la mission, soit ${commissionAmount.toFixed(2)} €. Le montant net revenant au Prestataire s’élève à ${netAmount.toFixed(2)} €. Les modalités de paiement au Prestataire sont gérées via NIOS (Stripe Connect).`, pageMargin, doc.y, { width: pageWidth });
      doc.y += 50;
      doc.moveDown(0.5);

      // ——— ARTICLE 7 – ACCEPTATION, OPPOSABILITÉ, DROIT APPLICABLE ———
      checkPageBreak(120);
      title().text("Article 7 – Acceptation, opposabilité et droit applicable", pageMargin, doc.y);
      doc.moveDown(0.4);
      drawHr(doc.y);
      doc.moveDown(0.5);
      normal();
      doc.text("La présente convention est opposable aux parties dès lors qu’elle a été acceptée par le Donneur d’ordre puis par le Prestataire (acceptation électronique via la plateforme NIOS). Elle est régie par le droit belge. En cas de litige, les tribunaux du siège du Donneur d’ordre seront compétents, sauf disposition impérative contraire.", pageMargin, doc.y, { width: pageWidth });
      doc.moveDown(0.6);
      if (agreement.companyAcceptedAt) {
        doc.text(`Acceptée par le Donneur d’ordre le : ${formatDate(agreement.companyAcceptedAt)}.`, pageMargin, doc.y, { width: pageWidth });
        doc.y += 14;
      }
      if (agreement.detailerAcceptedAt) {
        doc.text(`Acceptée par le Prestataire le : ${formatDate(agreement.detailerAcceptedAt)}.`, pageMargin, doc.y, { width: pageWidth });
        doc.y += 14;
      }
      doc.y += 20;
      doc.moveDown(0.5);

      // ——— FAIT EN DEUX EXEMPLAIRES ———
      checkPageBreak(50);
      doc.fontSize(10).font("Helvetica-Oblique");
      doc.text("Fait en deux exemplaires, un pour chaque partie.", pageMargin, doc.y, { width: pageWidth, align: "center" });
      doc.moveDown(0.5);
      doc.text(`Document généré par NIOS le ${formatDate(new Date().toISOString())}.`, pageMargin, doc.y, { width: pageWidth, align: "center" });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
