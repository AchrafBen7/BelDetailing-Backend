// src/app.js
console.log("🔄 [APP] Loading express and middleware...");
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import cron from "node-cron";
console.log("✅ [APP] Express and middleware loaded");

console.log("🔄 [APP] Loading cron jobs...");
import { autoCaptureBookings } from "./cron/autoCapture.js";
import { captureScheduledPayments } from "./cron/captureScheduledPayments.js";
import { retryFailedTransfers } from "./cron/retryFailedTransfers.js";
import { captureDayOnePaymentsCron } from "./cron/captureDayOnePayments.js";
import { runBookingStatusTransitions } from "./cron/bookingStatusTransitions.js";
import { transferBookingToProviderCron } from "./cron/transferBookingToProvider.js";
console.log("✅ [APP] Cron jobs loaded");

console.log("🔄 [APP] Loading config and observability...");
import { supabaseAdmin as supabase } from "./config/supabase.js";
import { httpLogger } from "./observability/logger.js";
import { metricsEndpoint, metricsMiddleware } from "./observability/metrics.js";
console.log("✅ [APP] Config and observability loaded");
// Redis sera initialisé après le démarrage du serveur (dans server.js)

console.log("🔄 [APP] Loading routes (this may take a moment)...");
const startRoutesImport = Date.now();
import authRoutes from "./routes/auth.routes.js";
import profileRoutes from "./routes/profile.routes.js";
import providerRoutes from "./routes/provider.route.js";
import bookingsRoutes from "./routes/booking.routes.js";
import offerRoutes from "./routes/offer.routes.js";
import applicationRoutes from "./routes/application.routes.js";
import reviewRoutes from "./routes/review.routes.js";
import cityRoutes from "./routes/city.routes.js";
import searchRoutes from "./routes/search.routes.js";
import serviceCategoryRoutes from "./routes/service-category.routes.js";
import mediaRoutes from "./routes/media.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import stripeWebhookRoutes from "./routes/stripeWebhook.routes.js";
import stripeConnectRoutes from "./routes/stripeConnect.routes.js";
import productRoutes from "./routes/product.routes.js";
import productFavoriteRoutes from "./routes/productFavorite.routes.js";
import taxesRoutes from "./routes/taxes.routes.js";
import orderRoutes from "./routes/order.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import utilsRoutes from "./routes/utils.routes.js";
import cronRoutes from "./routes/cron.routes.js";
import vatRoutes from "./routes/vat.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import googleReviewRoutes from "./routes/googleReview.routes.js";
import portfolioRoutes from "./routes/portfolio.routes.js";
import servicePhotosRoutes from "./routes/servicePhotos.routes.js";
import noShowRoutes from "./routes/noShow.routes.js";
import referralRoutes from "./routes/referral.routes.js";
const routesImportTime = Date.now() - startRoutesImport;
console.log(`✅ [APP] All routes loaded in ${routesImportTime}ms`);

console.log("🔄 [APP] Creating Express app...");
const app = express();
console.log("✅ [APP] Express app created");

app.use(helmet());

const corsOrigin = process.env.CORS_ORIGIN;
app.use(
  cors({
    origin: corsOrigin ? corsOrigin.split(",").map((o) => o.trim()) : true,
    credentials: true,
  })
);

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use(httpLogger);
app.use((req, res, next) => {
  res.setHeader("x-request-id", req.id);
  next();
});

app.use(metricsMiddleware);

// ⚠️ 1) D’abord le webhook Stripe (il utilise express.raw dans le router)
app.use("/api/v1/stripe", stripeWebhookRoutes);

// ⚠️ 2) Ensuite seulement, le parser JSON pour le reste de l’API (limite 500kb)
app.use(express.json({ limit: "500kb" }));

// Auth
app.use("/api/v1/auth", authRoutes);

// Profile (même router, mais route "/" dedans)
app.use("/api/v1/profile", profileRoutes);

// Parrainage (lien d'invitation, stats)
app.use("/api/v1/referral", referralRoutes);

app.use("/api/v1/providers", providerRoutes);
app.use("/api/v1/providers", portfolioRoutes);
app.use("/api/v1/bookings", noShowRoutes);
app.use("/api/v1/bookings", bookingsRoutes);
app.use("/api/v1/offers", offerRoutes);
app.use("/api/v1/applications", applicationRoutes);
console.log("✅ [APP] Application routes configured");

import missionAgreementRoutes from "./routes/missionAgreement.routes.js";
import missionPaymentRoutes from "./routes/missionPayment.routes.js";
import missionInvoiceRoutes from "./routes/missionInvoice.routes.js";
console.log("✅ [APP] Mission routes loaded");

// Mission Agreements (doit être avant mission-payments pour éviter les conflits)
app.use("/api/v1/mission-agreements", missionAgreementRoutes);
console.log("✅ [APP] Mission Agreement routes configured");

// Mission Payments (routes imbriquées pour /mission-agreements/:id/payments)
app.use("/api/v1/mission-agreements", missionPaymentRoutes);
app.use("/api/v1/mission-payments", missionPaymentRoutes);
console.log("✅ [APP] Mission Payment routes configured");

// Mission Invoices (routes imbriquées pour /mission-agreements/:id/invoices)
app.use("/api/v1/mission-agreements", missionInvoiceRoutes);
app.use("/api/v1/mission-invoices", missionInvoiceRoutes);
console.log("✅ [APP] Mission Invoice routes configured");

import missionPayoutRoutes from "./routes/missionPayout.routes.js";
console.log("✅ [APP] Mission Payout routes loaded");
app.use("/api/v1/mission-payouts", missionPayoutRoutes);
console.log("✅ [APP] Mission Payout routes configured");

import missionPaymentScheduleRoutes from "./routes/missionPaymentSchedule.routes.js";
console.log("✅ [APP] Mission Payment Schedule routes loaded");
app.use("/api/v1/mission-payments/schedule", missionPaymentScheduleRoutes);
console.log("✅ [APP] Mission Payment Schedule routes configured");

app.use("/api/v1/reviews", reviewRoutes);
import companyReviewRoutes from "./routes/companyReview.routes.js";
app.use("/api/v1/company-reviews", companyReviewRoutes);
app.use("/api/v1/cities", cityRoutes);
app.use("/api/v1/search", searchRoutes);
app.use("/api/v1/service-categories", serviceCategoryRoutes);
app.use("/api/v1/services", servicePhotosRoutes);
app.use("/api/v1/media", mediaRoutes);
app.use("/api/v1/payments", paymentRoutes);
app.use("/api/v1/stripe", stripeConnectRoutes);

import sepaDirectDebitRoutes from "./routes/sepaDirectDebit.routes.js";
console.log("✅ [APP] SEPA Direct Debit routes loaded");
app.use("/api/v1/sepa", sepaDirectDebitRoutes);
console.log("✅ [APP] SEPA Direct Debit routes configured");
// ⚠️ IMPORTANT: Les routes de favoris doivent être AVANT productRoutes
// pour éviter que /favorites soit capturé par /:id
app.use("/api/v1/products", productFavoriteRoutes);
app.use("/api/v1/products", productRoutes);
app.use("/api/v1/taxes", taxesRoutes);
app.use("/api/v1/orders", orderRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/utils", utilsRoutes);
app.use("/api/v1/cron", cronRoutes);
app.use("/api/v1/vat", vatRoutes);
app.use("/api/v1/chat", chatRoutes);
app.use("/api/v1/reviews", googleReviewRoutes);

app.get("/metrics", metricsEndpoint);

// Healthcheck
app.get("/api/v1/health", async (req, res) => {
  try {
    const { error } = await supabase
      .from("provider_profiles")
      .select("id")
      .limit(1);

    if (error) {
      return res.status(503).json({
        status: "degraded",
        timestamp: Date.now(),
        db: "unhealthy",
      });
    }

    return res.json({
      status: "ok",
      timestamp: Date.now(),
      db: "healthy",
    });
  } catch (err) {
    return res.status(503).json({
      status: "degraded",
      timestamp: Date.now(),
      db: "unhealthy",
    });
  }
});


// Tâche cron pour capturer automatiquement les paiements des bookings terminés
cron.schedule("*/10 * * * *", async () => {
  console.log("CRON running autoCapture...");
  await autoCaptureBookings();
});

// Tâche cron pour capturer automatiquement les paiements programmés de missions
// S'exécute toutes les heures (à la minute 0 de chaque heure)
cron.schedule("0 * * * *", async () => {
  console.log("CRON running captureScheduledPayments...");
  try {
    const result = await captureScheduledPayments();
    console.log(`✅ CRON captureScheduledPayments completed: ${result.captured} captured, ${result.failed} failed, ${result.skipped} skipped`);
  } catch (err) {
    console.error("❌ CRON captureScheduledPayments error:", err);
  }
});

// Tâche cron pour retenter automatiquement les transferts échoués
// S'exécute toutes les 6 heures (à la minute 0 de chaque 6ème heure: 0, 6, 12, 18)
cron.schedule("0 */6 * * *", async () => {
  console.log("CRON running retryFailedTransfers...");
  try {
    const result = await retryFailedTransfers(10); // Limite de 10 transferts par exécution
    console.log(`✅ CRON retryFailedTransfers completed: ${result.succeeded} succeeded, ${result.failed} failed out of ${result.total} total`);
  } catch (err) {
    console.error("❌ CRON retryFailedTransfers error:", err);
  }
});

// Tâche cron pour libérer les acomptes à J+1 (jour après le premier jour de mission)
// S'exécute toutes les heures (à la minute 0 de chaque heure)
// Libère les acomptes capturés pour les missions dont le startDate était hier
import { releaseDepositsAtJPlusOneCron } from "./cron/releaseDepositsAtJPlusOne.js";
cron.schedule("0 * * * *", async () => {
  console.log("CRON running releaseDepositsAtJPlusOne...");
  try {
    const result = await releaseDepositsAtJPlusOneCron();
    console.log(`✅ CRON releaseDepositsAtJPlusOne completed: ${result.released} released, ${result.failed} failed, ${result.skipped} skipped`);
  } catch (err) {
    console.error("❌ CRON releaseDepositsAtJPlusOne error:", err);
  }
});

// Transitions de statut des bookings : confirmed → ready_soon (-15 min), ready_soon → started (à l'heure)
// S'exécute toutes les 5 minutes
cron.schedule("*/5 * * * *", async () => {
  try {
    await runBookingStatusTransitions();
  } catch (err) {
    console.error("❌ CRON bookingStatusTransitions error:", err);
  }
});

// Transfert au détaileur 3h après l'heure de résa (argent gelé jusqu'à ce moment)
cron.schedule("*/15 * * * *", async () => {
  try {
    const result = await transferBookingToProviderCron();
    if (result.transferred > 0 || result.failed > 0) {
      console.log(`✅ CRON transferBookingToProvider: ${result.transferred} transferred, ${result.failed} failed, ${result.skipped} skipped`);
    }
  } catch (err) {
    console.error("❌ CRON transferBookingToProvider error:", err);
  }
});

export default app;
