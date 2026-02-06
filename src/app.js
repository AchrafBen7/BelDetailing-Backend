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
// 🆕 Nouveaux crons pour missions B2B
import { startMissionPaymentsCron } from "./jobs/captureMissionPayments.js";
import { startSepaRetryJobCron } from "./jobs/retryFailedSepaPayments.js";
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
import reportRoutes from "./routes/report.routes.js";
import blockedUsersRoutes from "./routes/blocked-users.routes.js";
import adminRoutes from "./routes/admin.routes.js";
const routesImportTime = Date.now() - startRoutesImport;
console.log(`✅ [APP] All routes loaded in ${routesImportTime}ms`);

console.log("🔄 [APP] Creating Express app...");
const app = express();
console.log("✅ [APP] Express app created");

// 🛡️ SÉCURITÉ : Trust proxy si derrière un reverse proxy (Railway, Heroku, Nginx)
// Permet au rate limiting de voir la vraie IP du client (pas celle du proxy)
app.set("trust proxy", 1);

app.use(helmet());

// 🛡️ SÉCURITÉ : CORS strict avec origin explicite (pas origin: true en prod)
// ℹ️ NOTE : CORS ne s'applique PAS aux apps natives iOS/Android (URLSession bypass CORS)
// Cette protection est seulement pour les navigateurs web (ex: dashboard admin)
const corsOrigin = process.env.CORS_ORIGIN;

if (!corsOrigin && process.env.NODE_ENV === "production") {
  console.log("ℹ️ [CORS] CORS_ORIGIN non défini → Bloque les navigateurs web, autorise les apps natives");
}

app.use(
  cors({
    // Si CORS_ORIGIN défini → whitelist stricte
    // Sinon en prod → false (bloque navigateurs web, apps natives OK)
    // Sinon en dev → true (permissif pour debug)
    origin: corsOrigin 
      ? corsOrigin.split(",").map((o) => o.trim()) 
      : (process.env.NODE_ENV === "production" ? false : true),
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

// 🔒 SECURITY: Rate limiter strict pour les endpoints d'authentification
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Max 20 tentatives par IP sur 15 min (login, register, social, etc.)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts, please try again later" },
});

// Auth
app.use("/api/v1/auth", authRateLimit, authRoutes);

// Profile (même router, mais route "/" dedans)
app.use("/api/v1/profile", profileRoutes);

// Parrainage (lien d'invitation, stats)
app.use("/api/v1/referral", referralRoutes);

// Signalements (Apple Guidelines compliance)
app.use("/api/v1/reports", reportRoutes);

// Blocage d'utilisateurs (Apple Guidelines compliance)
app.use("/api/v1/users", blockedUsersRoutes);

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

// Admin Dashboard
app.use("/api/v1/admin", adminRoutes);

// 🛡️ SÉCURITÉ : Protéger /metrics en production avec un secret
app.get("/metrics", (req, res, next) => {
  if (process.env.NODE_ENV === "production") {
    const secret = req.headers["x-metrics-secret"];
    const expectedSecret = process.env.METRICS_SECRET;
    
    if (!expectedSecret) {
      console.warn("⚠️ [SECURITY] METRICS_SECRET non défini en production ! Endpoint /metrics désactivé.");
      return res.status(403).json({ error: "Metrics endpoint disabled" });
    }
    
    if (secret !== expectedSecret) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }
  next();
}, metricsEndpoint);

// ============================================================
// HEALTHCHECK — Basic (rapide, pour load balancer / uptime robot)
// ============================================================
app.get("/api/v1/health", async (req, res) => {
  try {
    const { error } = await supabase
      .from("users")
      .select("id")
      .limit(1);

    const uptime = process.uptime();
    const memUsage = process.memoryUsage();

    if (error) {
      return res.status(503).json({
        status: "degraded",
        version: process.env.npm_package_version || "1.0.0",
        uptime: Math.round(uptime),
        timestamp: new Date().toISOString(),
        db: "unhealthy",
      });
    }

    return res.json({
      status: "ok",
      version: process.env.npm_package_version || "1.0.0",
      uptime: Math.round(uptime),
      timestamp: new Date().toISOString(),
      db: "healthy",
      memory: {
        rss: Math.round(memUsage.rss / 1024 / 1024),
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      },
    });
  } catch (err) {
    return res.status(503).json({
      status: "error",
      timestamp: new Date().toISOString(),
      db: "unreachable",
    });
  }
});

// ============================================================
// DEEP HEALTHCHECK — Teste chaque dependance (admin / monitoring)
// ============================================================
app.get("/api/v1/health/deep", async (req, res) => {
  const checks = {};
  let overallStatus = "ok";

  // 1) Supabase DB
  try {
    const start = Date.now();
    const { error } = await supabase.from("users").select("id").limit(1);
    checks.supabase = {
      status: error ? "unhealthy" : "healthy",
      latencyMs: Date.now() - start,
      error: error?.message || null,
    };
    if (error) overallStatus = "degraded";
  } catch (err) {
    checks.supabase = { status: "unreachable", error: err.message };
    overallStatus = "degraded";
  }

  // 2) Redis
  try {
    const { getRedisClient } = await import("./config/redis.js");
    const redis = getRedisClient();
    const start = Date.now();
    await redis.ping();
    checks.redis = { status: "healthy", latencyMs: Date.now() - start };
  } catch (err) {
    checks.redis = { status: "unavailable", error: err.message };
    // Redis est optionnel, on ne degrade pas le status global
  }

  // 3) Stripe
  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const start = Date.now();
    await stripe.balance.retrieve();
    checks.stripe = { status: "healthy", latencyMs: Date.now() - start };
  } catch (err) {
    checks.stripe = { status: "unhealthy", error: err.message };
    overallStatus = "degraded";
  }

  // 4) Cron jobs (derniere execution via cron_locks)
  try {
    const { data: locks } = await supabase
      .from("cron_locks")
      .select("job_name, locked_at, locked_by")
      .order("locked_at", { ascending: false })
      .limit(20);

    checks.cronJobs = (locks || []).map((l) => ({
      job: l.job_name,
      lastRun: l.locked_at,
      instance: l.locked_by,
    }));
  } catch (err) {
    checks.cronJobs = { status: "unknown", error: err.message };
  }

  // 5) Uptime & Memory
  checks.system = {
    uptime: Math.round(process.uptime()),
    nodeVersion: process.version,
    memory: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    },
    env: process.env.NODE_ENV || "development",
  };

  const statusCode = overallStatus === "ok" ? 200 : 503;
  return res.status(statusCode).json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    checks,
  });
});


// ============================================================
// CRON JOBS — avec logging structuré (Pino)
// ============================================================
import { logger } from "./observability/logger.js";
import { releaseDepositsAtJPlusOneCron } from "./cron/releaseDepositsAtJPlusOne.js";

const cronLogger = logger.child({ module: "cron" });

// Helper : wrapper cron avec logging structuré
async function runCron(name, fn) {
  const start = Date.now();
  cronLogger.info({ job: name }, `CRON ${name} started`);
  try {
    const result = await fn();
    const durationMs = Date.now() - start;
    cronLogger.info({ job: name, durationMs, result }, `CRON ${name} completed`);
    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    cronLogger.error({ job: name, durationMs, err: err.message, stack: err.stack }, `CRON ${name} FAILED`);
    return null;
  }
}

// autoCapture — toutes les 10 minutes
cron.schedule("*/10 * * * *", () => runCron("autoCapture", autoCaptureBookings));

// captureScheduledPayments — toutes les heures
cron.schedule("0 * * * *", () => runCron("captureScheduledPayments", captureScheduledPayments));

// retryFailedTransfers — toutes les 6 heures
cron.schedule("0 */6 * * *", () => runCron("retryFailedTransfers", () => retryFailedTransfers(10)));

// releaseDepositsAtJPlusOne — toutes les heures
cron.schedule("0 * * * *", () => runCron("releaseDepositsAtJPlusOne", releaseDepositsAtJPlusOneCron));

// bookingStatusTransitions — toutes les 5 minutes
cron.schedule("*/5 * * * *", () => runCron("bookingStatusTransitions", runBookingStatusTransitions));

// transferBookingToProvider — toutes les 15 minutes
cron.schedule("*/15 * * * *", () => runCron("transferBookingToProvider", transferBookingToProviderCron));

// 🆕 Capture automatique des paiements mensuels programmés (missions B2B)
// S'exécute tous les jours à 9h (Europe/Brussels)
console.log("✅ [CRON] Initializing mission payments capture job...");
startMissionPaymentsCron();

// 🆕 Retry automatique des paiements SEPA échoués (missions B2B)
// S'exécute toutes les 6 heures (00:00, 06:00, 12:00, 18:00)
console.log("✅ [CRON] Initializing SEPA retry job...");
startSepaRetryJobCron();

export default app;
