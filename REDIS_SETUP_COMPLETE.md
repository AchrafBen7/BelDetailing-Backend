# 🚀 Setup Redis Complet - Guide de A à Z

## ✅ Ce qui a été fait

### 1. Installation
- ✅ `ioredis` installé dans `package.json`
- ✅ Configuration Redis dans `src/config/redis.js`
- ✅ Middleware de cache dans `src/middlewares/cache.middleware.js`
- ✅ Initialisation Redis dans `src/app.js`
- ✅ Fermeture propre dans `src/server.js`

### 2. Intégration du Cache

#### Endpoints avec Cache Activé :

| Endpoint | TTL | Priorité |
|----------|-----|----------|
| `GET /api/v1/providers` | 10 min | ⭐⭐⭐ |
| `GET /api/v1/providers/:id` | 15 min | ⭐⭐⭐ |
| `GET /api/v1/offers` | 5 min | ⭐⭐⭐ |
| `GET /api/v1/offers/:id` | 10 min | ⭐⭐⭐ |
| `GET /api/v1/cities` | 24h | ⭐⭐⭐ |
| `GET /api/v1/service-categories` | 24h | ⭐⭐ |

### 3. Invalidation de Cache

✅ **Automatique après modifications** :
- Mise à jour d'un provider → Invalide `provider/:id` + liste
- Création/modification/fermeture/suppression d'offre → Invalide `offer/:id` + liste

## 📋 Configuration Requise

### 1. Variables d'Environnement

Ajoutez dans votre `.env` :

```env
# Redis Configuration
REDIS_URL=redis://localhost:6379

# Pour production (exemple avec Redis Cloud ou Upstash)
# REDIS_URL=redis://default:password@your-redis-host:6379
```

### 2. Installation Redis Locale (Développement)

#### Option A : Docker (Recommandé)
```bash
docker run -d \
  --name redis-beldetailing \
  -p 6379:6379 \
  redis:7-alpine
```

#### Option B : Homebrew (macOS)
```bash
brew install redis
brew services start redis
```

#### Option C : Linux (Ubuntu/Debian)
```bash
sudo apt-get update
sudo apt-get install redis-server
sudo systemctl start redis-server
sudo systemctl enable redis-server
```

### 3. Vérifier que Redis fonctionne

```bash
# Test de connexion
redis-cli ping
# Devrait répondre : PONG
```

## 🧪 Test du Cache

### 1. Démarrer le serveur
```bash
npm run dev
```

Vous devriez voir dans les logs :
```
✅ [Redis] Connected to Redis
✅ [Redis] Ready to accept commands
```

### 2. Tester un endpoint

```bash
# Premier appel (cache MISS)
curl http://localhost:8000/api/v1/providers

# Deuxième appel (cache HIT - beaucoup plus rapide)
curl http://localhost:8000/api/v1/providers

# Vérifier les headers
curl -I http://localhost:8000/api/v1/providers
# Devrait contenir : X-Cache: HIT ou X-Cache: MISS
```

### 3. Forcer un refresh (bypass cache)

```bash
curl http://localhost:8000/api/v1/providers?no-cache=true
```

## 🔍 Monitoring

### Voir les clés en cache
```bash
redis-cli
> KEYS cache:*
> GET cache:providers:list:default
```

### Statistiques Redis
```bash
redis-cli INFO stats
```

### Vider le cache (développement uniquement)
```bash
redis-cli FLUSHDB
```

## 🚀 Production

### Options Recommandées

1. **Redis Cloud** (https://redis.com/cloud/)
   - Gratuit jusqu'à 30MB
   - Gestion automatique
   - Backup inclus

2. **Upstash** (https://upstash.com/)
   - Serverless Redis
   - Pay-per-use
   - Parfait pour scaling

3. **AWS ElastiCache** (si déjà sur AWS)
   - Intégration native
   - Haute disponibilité

### Configuration Production

```env
REDIS_URL=rediss://default:password@your-redis-host:6379
```

⚠️ **Important** : Utilisez `rediss://` (avec SSL) en production !

## 📊 Bénéfices Attendus

- ⚡ **Latence réduite** : 200-500ms → 10-50ms
- 💰 **Coûts réduits** : 60-80% moins de requêtes Supabase
- 📈 **Scalabilité** : Cache partagé entre instances
- 🔄 **Disponibilité** : Fallback automatique si Redis down

## ⚠️ Points d'Attention

1. **Redis n'est pas obligatoire** : L'app fonctionne sans Redis (sans cache)
2. **Invalidation** : Toujours invalider après modifications
3. **TTL adaptatif** : Ajuster selon le type de données
4. **Monitoring** : Surveiller l'utilisation mémoire Redis

## 🐛 Troubleshooting

### Redis ne se connecte pas
```bash
# Vérifier que Redis tourne
redis-cli ping

# Vérifier les logs du serveur
# Chercher les messages [Redis] dans les logs
```

### Cache ne fonctionne pas
1. Vérifier `REDIS_URL` dans `.env`
2. Vérifier les logs : `✅ [Redis] Ready to accept commands`
3. Tester avec `redis-cli KEYS cache:*`

### Performance
- Si Redis est lent, vérifier la mémoire disponible
- Surveiller avec `redis-cli INFO memory`

## 📝 Prochaines Étapes

1. ✅ Redis installé et configuré
2. ✅ Cache activé sur endpoints prioritaires
3. ✅ Invalidation automatique
4. 🔄 **À faire** : Monitoring et métriques de cache hit rate
5. 🔄 **À faire** : Cache pour produits (optionnel)
