// src/app.js
import express from "express";
import cors from "cors";

import authRoutes from "./routes/auth.routes.js";
import profileRoutes from "./routes/profile.routes.js";
import providerRoutes from "./routes/provider.route.js";

const app = express();

app.use(cors());
app.use(express.json());

// Auth
app.use("/api/v1/auth", authRoutes);

// Profile (même router, mais route "/" dedans)
app.use("/api/v1/profile", profileRoutes);

app.use("/api/v1/providers", providerRoutes);

// Healthcheck
app.get("/api/v1/health", (req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

export default app;
