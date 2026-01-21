# ⚡ Redis Quick Start - 5 Minutes

## 🎯 Objectif
Mettre en place Redis pour le caching en 5 minutes.

## ✅ Checklist

### 1. Installation Redis (2 min)

**Option A : Docker (Recommandé)**
```bash
docker run -d --name redis-beldetailing -p 6379:6379 redis:7-alpine
```

**Option B : Homebrew (macOS)**
```bash
brew install redis
brew services start redis
```

**Option C : Linux**
```bash
sudo apt-get install redis-server
sudo systemctl start redis-server
```

### 2. Configuration .env (30 sec)

Ajoutez dans votre `.env` :
```env
REDIS_URL=redis://localhost:6379
```

### 3. Test (30 sec)

```bash
# Vérifier que Redis fonctionne
redis-cli ping
# Devrait répondre : PONG

# Tester la connexion depuis Node.js
npm run test:redis
```

### 4. Démarrer le serveur (30 sec)

```bash
npm run dev
```

Vous devriez voir :
```
✅ [Redis] Connected to Redis
✅ [Redis] Ready to accept commands
```

### 5. Tester un endpoint (1 min)

```bash
# Premier appel (cache MISS)
curl http://localhost:8000/api/v1/providers

# Deuxième appel (cache HIT - beaucoup plus rapide)
curl http://localhost:8000/api/v1/providers

# Vérifier le header X-Cache
curl -I http://localhost:8000/api/v1/providers
```

## 🎉 C'est fait !

Votre cache Redis est maintenant actif sur :
- ✅ `GET /api/v1/providers` (10 min)
- ✅ `GET /api/v1/providers/:id` (15 min)
- ✅ `GET /api/v1/offers` (5 min)
- ✅ `GET /api/v1/offers/:id` (10 min)
- ✅ `GET /api/v1/cities` (24h)
- ✅ `GET /api/v1/service-categories` (24h)

## 🔍 Vérification

```bash
# Voir les clés en cache
redis-cli
> KEYS cache:*
> GET cache:providers:list:default
```

## 📚 Documentation Complète

Voir `REDIS_SETUP_COMPLETE.md` pour plus de détails.
