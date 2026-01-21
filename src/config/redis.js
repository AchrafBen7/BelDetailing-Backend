// src/config/redis.js
import Redis from "ioredis";

let redisClient = null;

/**
 * Initialise la connexion Redis
 */
export function getRedisClient() {
  if (!redisClient) {
    // ⚠️ IMPORTANT : En production (Render), REDIS_URL doit être défini dans les variables d'environnement
    // Si REDIS_URL n'est pas défini, on ne crée PAS de client Redis (évite les erreurs de connexion)
    const redisUrl = process.env.REDIS_URL;
    
    if (!redisUrl) {
      console.warn("⚠️ [Redis] REDIS_URL not set - Redis cache will be disabled");
      return null;
    }
    
    console.log("🔵 [Redis] Connecting to:", redisUrl.replace(/:[^:@]+@/, ":****@"));
    
    redisClient = new Redis(redisUrl, {
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      enableOfflineQueue: true, // Permet de mettre en queue si pas encore connecté
      connectTimeout: 5000, // 5 secondes timeout (réduit)
      lazyConnect: true, // ⚡ Connexion lazy - ne bloque pas le démarrage
      showFriendlyErrorStack: false,
    });

    redisClient.on("error", (err) => {
      console.error("❌ [Redis] Connection error:", err);
      // Ne pas faire planter l'app si Redis est down
    });

    redisClient.on("connect", () => {
      console.log("✅ [Redis] Connected to Redis");
    });

    redisClient.on("ready", () => {
      console.log("✅ [Redis] Ready to accept commands");
    });
  }

  return redisClient;
}

/**
 * Ferme la connexion Redis (utile pour les tests)
 */
export async function closeRedisConnection() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
