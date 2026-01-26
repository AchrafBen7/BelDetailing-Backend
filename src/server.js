// ⚠️ CRITIQUE : Charger dotenv EN PREMIER, avant TOUS les autres imports
// Avec ES modules, les imports sont évalués avant l'exécution du code
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Obtenir le répertoire du fichier actuel
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Charger .env depuis le répertoire racine du projet (Backend/BelDetailing-Backend)
const envPath = join(__dirname, "..", ".env");
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.error("❌ [ENV] Error loading .env file:", result.error);
  console.error("❌ [ENV] Tried path:", envPath);
} else {
  const loadedCount = Object.keys(result.parsed || {}).length;
  console.log(`✅ [ENV] Loaded ${loadedCount} variables from .env`);
  if (loadedCount === 0) {
    console.warn("⚠️ [ENV] No variables loaded! Check .env file format.");
  }
}

// Maintenant on peut importer le reste
// Note: Les logs après les imports peuvent ne pas s'afficher immédiatement
// car les imports ES modules sont évalués avant l'exécution du code
console.log("🔄 [SERVER] Starting imports...");

console.log("🔄 [SERVER] Loading tracing...");
import { shutdownTracing } from "./observability/tracing.js";
console.log("✅ [SERVER] Tracing loaded");

console.log("🔄 [SERVER] Loading app (this may take a moment)...");
const startAppImport = Date.now();
import app from "./app.js";
const appImportTime = Date.now() - startAppImport;
console.log(`✅ [SERVER] App loaded in ${appImportTime}ms`);

console.log("✅ [SERVER] All dependencies loaded");

const PORT = process.env.PORT || 8000;

const server = app.listen(PORT, () => {
  console.log(`✅ BelDetailing API running on http://localhost:${PORT}`);
  
  // Initialiser Redis après que le serveur soit démarré (non-bloquant)
  setImmediate(async () => {
    try {
      const { getRedisClient } = await import("./config/redis.js");
      const redis = getRedisClient();
      redis.connect().catch(() => {
        // Silently fail, will retry on first use
      });
    } catch (err) {
      // Silently fail, cache will be disabled
    }
  });
});

const shutdown = signal => {
  console.log(`Received ${signal}, shutting down...`);
  server.close(async () => {
    // Fermer la connexion Redis proprement
    try {
      const { getRedisClient } = await import("./config/redis.js");
      const redis = getRedisClient();
      if (redis) {
        await redis.quit();
        console.log("✅ [Redis] Connection closed");
      }
    } catch (err) {
      // Silently fail
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
