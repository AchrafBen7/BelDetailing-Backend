// src/app.js
import express from "express";
import cors from "cors";

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

const app = express();

app.use(cors());
app.use(express.json());

// Auth
app.use("/api/v1/auth", authRoutes);

// Profile (même router, mais route "/" dedans)
app.use("/api/v1/profile", profileRoutes);

app.use("/api/v1/providers", providerRoutes);

app.use("/api/v1/bookings", bookingsRoutes);

app.use("/api/v1/offers", offerRoutes);

app.use("/api/v1/applications", applicationRoutes);

app.use("/api/v1/reviews", reviewRoutes);

app.use("/api/v1/cities", cityRoutes);

app.use("/api/v1/search", searchRoutes);

app.use("/api/v1/service-categories", serviceCategoryRoutes);

app.use("/api/v1/media", mediaRoutes);

// Healthcheck
app.get("/api/v1/health", (req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

export default app;
