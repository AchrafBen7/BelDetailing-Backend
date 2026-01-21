# 🚀 Guide d'Amélioration du Caching

## 📊 État Actuel du Caching

### Backend
- ❌ **Aucun Redis installé**
- ❌ **Aucun middleware de cache**
- ✅ Cache HTTP basique pour médias (3600s)
- ✅ Cache JWKS Apple (24h via jwks-rsa)

### iOS
- ✅ **UserDefaults** pour cache persistant (Providers, Bookings, Offers)
- ✅ **NSCache** pour images en mémoire
- ❌ **Pas de TTL** → Données obsolètes possibles
- ❌ **Pas de stratégie intelligente**

## 🎯 Plan d'Amélioration

### Phase 1 : Backend - Redis (Recommandé)

#### Installation
```bash
cd Backend/BelDetailing-Backend
npm install ioredis
```

#### Configuration (.env)
```env
REDIS_URL=redis://localhost:6379
# Ou pour production :
# REDIS_URL=redis://your-redis-host:6379
```

#### Endpoints Prioritaires à Cacher

| Endpoint | TTL | Priorité |
|----------|-----|----------|
| `GET /api/v1/providers` | 10 min | ⭐⭐⭐ HAUTE |
| `GET /api/v1/providers/:id` | 15 min | ⭐⭐⭐ HAUTE |
| `GET /api/v1/offers` | 5 min | ⭐⭐⭐ HAUTE |
| `GET /api/v1/cities` | 24h | ⭐⭐⭐ HAUTE |
| `GET /api/v1/service-categories` | 24h | ⭐⭐ MOYENNE |
| `GET /api/v1/products` | 30 min | ⭐⭐ MOYENNE |
| `GET /api/v1/bookings` | 2 min | ⭐ BASSE |

#### Exemple d'Intégration

```javascript
// src/routes/provider.route.js
import { cacheMiddleware } from "../middlewares/cache.middleware.js";

// Liste des providers (cache 10 min)
router.get(
  "/",
  cacheMiddleware({ ttl: 600 }),
  listProviders
);

// Détail d'un provider (cache 15 min)
router.get(
  "/:id",
  cacheMiddleware({ 
    ttl: 900,
    keyGenerator: (req) => `provider:${req.params.id}` 
  }),
  getProvider
);
```

#### Invalidation de Cache

```javascript
// Après mise à jour d'un provider
import { invalidateProviderCache } from "../middlewares/cache.middleware.js";

export async function updateProviderController(req, res) {
  const updated = await updateProvider(req.params.id, req.body);
  await invalidateProviderCache(req.params.id); // Invalide le cache
  return res.json(updated);
}
```

### Phase 2 : iOS - Cache Intelligent (Recommandé)

#### Nouveau CacheManager avec TTL

Le nouveau `CacheManager` remplace `StorageManager` pour le cache de données :

```swift
// Au lieu de :
StorageManager.shared.saveCachedProviders(providers)

// Utiliser :
CacheManager.shared.saveProviders(providers) // Avec TTL automatique
```

#### Stratégies de Cache

1. **Cache-First** (pour données peu critiques) :
   - Afficher cache → Si expiré → Rafraîchir en background
   
2. **Network-First** (pour données critiques) :
   - Aller au réseau → Si erreur → Fallback cache
   
3. **Stale-While-Revalidate** :
   - Afficher cache même si stale → Rafraîchir en background

#### Exemple d'Implémentation

```swift
// HomeViewModel.swift
func load() async {
    // 1. Essayer le cache d'abord
    if let cached = CacheManager.shared.getProvidersWithStaleness() {
        self.recommended = cached.data
        
        // Si stale, rafraîchir en background
        if cached.isStale {
            Task {
                await refreshProviders()
            }
        }
        return
    }
    
    // 2. Aller au réseau
    await refreshProviders()
}

private func refreshProviders() async {
    let result = await engine.userService.recommendedProviders(limit: 10)
    switch result {
    case .success(let list):
        self.recommended = list
        CacheManager.shared.saveProviders(list)
    case .failure(let err):
        // Fallback cache même si expiré
        if let cache = CacheManager.shared.getProviders() {
            self.recommended = cache
        }
    }
}
```

## 📈 Bénéfices Attendus

### Backend
- ✅ **Réduction de la charge Supabase** de 60-80%
- ✅ **Latence réduite** de 200-500ms → 10-50ms
- ✅ **Scalabilité améliorée** (cache partagé entre instances)
- ✅ **Coût réduit** (moins de requêtes Supabase)

### iOS
- ✅ **Expérience utilisateur améliorée** (affichage instantané)
- ✅ **Moins de requêtes réseau** (économise la batterie)
- ✅ **Fonctionne offline** (grace au cache)
- ✅ **Données toujours fraîches** (avec TTL)

## 🚦 Priorités d'Implémentation

1. **HAUTE** : Redis backend pour providers et offers
2. **HAUTE** : CacheManager iOS avec TTL
3. **MOYENNE** : Cache disque pour images iOS
4. **BASSE** : Cache pour produits et autres

## ⚠️ Points d'Attention

- **Invalidation** : Toujours invalider le cache après modifications
- **TTL adaptatif** : Ajuster selon le type de données
- **Fallback** : Toujours avoir un fallback si Redis/cache est down
- **Monitoring** : Surveiller le hit rate du cache
