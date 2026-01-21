// src/app.js
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cron from "node-cron";
import { autoCaptureBookings } from "./cron/autoCapture.js";
import { supabaseAdmin as supabase } from "./config/supabase.js";
import { httpLogger } from "./observability/logger.js";
import { metricsEndpoint, metricsMiddleware } from "./observability/metrics.js";
import { getRedisClient } from "./config/redis.js";

// Initialiser Redis au démarrage (optionnel, mais recommandé pour tester la connexion)
try {
  const redis = getRedisClient();
  console.log("🔵 [Redis] Initializing Redis connection...");
} catch (err) {
  console.warn("⚠️ [Redis] Redis not available, continuing without cache:", err.message);
}

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
const app = express();

app.use(helmet());

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

// ⚠️ 2) Ensuite seulement, le parser JSON pour le reste de l’API
app.use(express.json());

// Auth
app.use("/api/v1/auth", authRoutes);

// Profile (même router, mais route "/" dedans)
app.use("/api/v1/profile", profileRoutes);

app.use("/api/v1/providers", providerRoutes);
app.use("/api/v1/providers", portfolioRoutes);
app.use("/api/v1/bookings", noShowRoutes);
app.use("/api/v1/bookings", bookingsRoutes);
app.use("/api/v1/offers", offerRoutes);
app.use("/api/v1/applications", applicationRoutes);
app.use("/api/v1/reviews", reviewRoutes);
app.use("/api/v1/cities", cityRoutes);
app.use("/api/v1/search", searchRoutes);
app.use("/api/v1/service-categories", serviceCategoryRoutes);
app.use("/api/v1/services", servicePhotosRoutes);
app.use("/api/v1/media", mediaRoutes);
app.use("/api/v1/payments", paymentRoutes);
app.use("/api/v1/stripe", stripeConnectRoutes);
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

export default app;
