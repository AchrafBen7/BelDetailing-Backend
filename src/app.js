// src/app.js
import express from "express";
import cors from "cors";

import authRoutes from "./routes/auth.routes.js";

const app = express();

app.use(cors());
app.use(express.json());

// Auth
app.use("/api/v1/auth", authRoutes);

// Profile (même router, mais route "/" dedans)
app.use("/api/v1/profile", authRoutes);

// Healthcheck
app.get("/api/v1/health", (req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

export default app;
