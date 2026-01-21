import { shutdownTracing } from "./observability/tracing.js";
import app from "./app.js";
import "dotenv/config";
import dotenv from "dotenv";
import { getRedisClient } from "./config/redis.js";
dotenv.config();

console.log("SERVER ENV SUPABASE_URL =", process.env.SUPABASE_URL);

const PORT = process.env.PORT || 8000;

const server = app.listen(PORT, () => {
  console.log(`BelDetailing API running on http://localhost:${PORT}`);
});

const shutdown = signal => {
  console.log(`Received ${signal}, shutting down...`);
  server.close(async () => {
    // Fermer la connexion Redis proprement
    try {
      const redis = getRedisClient();
      if (redis) {
        await redis.quit();
        console.log("✅ [Redis] Connection closed");
      }
    } catch (err) {
      console.error("❌ [Redis] Error closing connection:", err);
    }
    
    shutdownTracing()
      .then(() => {
        console.log("HTTP server closed.");
        process.exit(0);
      })
      .catch(() => {
        console.log("HTTP server closed.");
        process.exit(0);
      });
  });

  setTimeout(() => {
    console.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 10000);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
