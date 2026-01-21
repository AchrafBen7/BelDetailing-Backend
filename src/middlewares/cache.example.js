// Exemples d'utilisation du cache middleware

import { cacheMiddleware } from "./cache.middleware.js";
import { invalidateProviderCache, invalidateOfferCache } from "./cache.middleware.js";

// ============================================================
// EXEMPLE 1: Cache simple avec TTL par défaut (5 min)
// ============================================================
router.get(
  "/providers",
  cacheMiddleware({ ttl: 600 }), // 10 minutes
  listProviders
);

// ============================================================
// EXEMPLE 2: Cache avec keyGenerator personnalisé
// ============================================================
router.get(
  "/providers/:id",
  cacheMiddleware({
    ttl: 900, // 15 minutes
    keyGenerator: (req) => `provider:${req.params.id}:${req.user?.id || "anon"}`,
  }),
  getProvider
);

// ============================================================
// EXEMPLE 3: Cache avec condition skip
// ============================================================
router.get(
  "/bookings",
  cacheMiddleware({
    ttl: 60, // 1 minute seulement
    skipCache: (req) => {
      // Ne pas cacher si l'utilisateur demande un refresh explicite
      return req.query.refresh === "true";
    },
  }),
  listBookings
);

// ============================================================
// EXEMPLE 4: Invalidation après modification
// ============================================================
export async function updateProviderController(req, res) {
  try {
    const updated = await updateProvider(req.params.id, req.body);
    
    // Invalider le cache du provider modifié
    await invalidateProviderCache(req.params.id);
    
    return res.json(updated);
  } catch (err) {
    // ...
  }
}

// ============================================================
// EXEMPLE 5: Données statiques (cache long)
// ============================================================
router.get(
  "/cities",
  cacheMiddleware({ ttl: 86400 }), // 24 heures
  listCities
);

router.get(
  "/service-categories",
  cacheMiddleware({ ttl: 86400 }), // 24 heures
  listServiceCategories
);
