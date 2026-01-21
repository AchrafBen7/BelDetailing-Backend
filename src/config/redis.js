// src/config/redis.js
import Redis from "ioredis";

let redisClient = null;

/**
 * Initialise la connexion Redis
 */
export function getRedisClient() {
  if (!redisClient) {
    const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    
    redisClient = new Redis(redisUrl, {
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      enableOfflineQueue: true, // Permet de mettre en queue si pas encore connecté
      connectTimeout: 10000, // 10 secondes timeout
      lazyConnect: false, // Se connecte immédiatement
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
