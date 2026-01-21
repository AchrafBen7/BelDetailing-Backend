// src/middlewares/cache.middleware.js
import { getRedisClient } from "../config/redis.js";

/**
 * Middleware de cache Redis pour Express
 * 
 * @param {Object} options
 * @param {number} options.ttl - Time to live en secondes
 * @param {Function} options.keyGenerator - Fonction pour générer la clé de cache (optionnel)
 * @param {boolean} options.skipCache - Condition pour ignorer le cache (optionnel)
 */
export function cacheMiddleware(options = {}) {
  const { ttl = 300, keyGenerator, skipCache } = options;

  return async (req, res, next) => {
    // Si Redis n'est pas disponible, on passe sans cache
    const redis = getRedisClient();
    if (!redis || redis.status !== "ready") {
      return next();
    }

    // Option pour ignorer le cache (ex: ?no-cache=true)
    if (req.query["no-cache"] === "true" || skipCache?.(req)) {
      return next();
    }

    // Générer la clé de cache
    const cacheKey = keyGenerator
      ? keyGenerator(req)
      : `cache:${req.method}:${req.originalUrl}:${JSON.stringify(req.query)}`;

    try {
      // 1. Vérifier le cache
      const cached = await redis.get(cacheKey);

      if (cached) {
        console.log(`✅ [CACHE] Hit: ${cacheKey}`);
        const data = JSON.parse(cached);
        
        // Ajouter les headers de cache
        res.setHeader("X-Cache", "HIT");
        res.setHeader("Cache-Control", `public, max-age=${ttl}`);
        
        return res.json(data);
      }

      // 2. Pas de cache → passer au controller
      // On intercepte la réponse pour la mettre en cache
      const originalJson = res.json.bind(res);
      res.json = function (data) {
        // Mettre en cache seulement si succès (status 200-299)
        if (res.statusCode >= 200 && res.statusCode < 300) {
          redis
            .setex(cacheKey, ttl, JSON.stringify(data))
            .catch((err) => {
              console.error(`❌ [CACHE] Error setting cache for ${cacheKey}:`, err);
            });
        }

        res.setHeader("X-Cache", "MISS");
        return originalJson(data);
      };

      return next();
    } catch (err) {
      console.error(`❌ [CACHE] Error:`, err);
      // En cas d'erreur Redis, on continue sans cache
      return next();
    }
  };
}

/**
 * Invalide un cache par pattern
 * 
 * @param {string} pattern - Pattern Redis (ex: "cache:GET:/api/v1/providers:*")
 */
export async function invalidateCache(pattern) {
  const redis = getRedisClient();
  if (!redis || redis.status !== "ready") {
    return;
  }

  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
      console.log(`🗑️ [CACHE] Invalidated ${keys.length} keys matching: ${pattern}`);
    }
  } catch (err) {
    console.error(`❌ [CACHE] Error invalidating cache:`, err);
  }
}

/**
 * Invalide le cache d'un provider spécifique
 */
export async function invalidateProviderCache(providerId) {
  await invalidateCache(`cache:GET:/api/v1/providers/${providerId}*`);
  await invalidateCache(`cache:GET:/api/v1/providers*`); // Invalider aussi la liste
}

/**
 * Invalide le cache d'une offre spécifique
 */
export async function invalidateOfferCache(offerId) {
  await invalidateCache(`cache:GET:/api/v1/offers/${offerId}*`);
  await invalidateCache(`cache:GET:/api/v1/offers*`); // Invalider aussi la liste
}
