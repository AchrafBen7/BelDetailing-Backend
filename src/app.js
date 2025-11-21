import express from "express";
import cors from "cors";

import authRoutes from "./routes/auth.routes.js";
import profileRoutes from "./routes/profile.routes.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/profile", profileRoutes);

// Health
app.get("/api/v1/health", (req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

export default app;
