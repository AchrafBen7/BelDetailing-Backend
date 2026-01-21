# 🐳 Guide Docker Redis - Développement Local

## 🎯 Pourquoi Docker Local ?

### Avantages :
- ✅ **Gratuit** - Ne consomme pas votre quota Redis Cloud FREE
- ✅ **Rapide** - Latence locale (~1ms)
- ✅ **Isolé** - Tests sans toucher à Redis Cloud
- ✅ **Facile** - Peut vider le cache facilement
- ✅ **Offline** - Fonctionne sans internet

## 🚀 Setup Rapide

### 1. Démarrer Redis avec Docker Compose

```bash
cd Backend/BelDetailing-Backend
docker-compose up -d
```

### 2. Vérifier que Redis tourne

```bash
docker ps | grep redis
# Devrait afficher : redis-beldetailing-dev
```

### 3. Tester la connexion

```bash
# Option 1: Via docker exec
docker exec -it redis-beldetailing-dev redis-cli ping
# Devrait répondre : PONG

# Option 2: Via le script Node.js
# Modifiez .env : REDIS_URL=redis://localhost:6379
npm run test:redis
```

## 🔄 Basculer entre Redis Cloud et Docker Local

### Utiliser Docker Local (Développement)

Dans `.env` :
```env
REDIS_URL=redis://localhost:6379
```

### Utiliser Redis Cloud (Production)

Dans `.env` :
```env
REDIS_URL=redis://default:FyKK4Jtj5mOAgnjiH2cz3OiNjmn3pbku@redis-18398.c304.europe-west1-2.gce.cloud.redislabs.com:18398
```

## 🛠️ Commandes Utiles

### Démarrer Redis
```bash
docker-compose up -d
```

### Arrêter Redis
```bash
docker-compose down
```

### Voir les logs
```bash
docker-compose logs -f redis
```

### Accéder à redis-cli
```bash
docker exec -it redis-beldetailing-dev redis-cli
```

### Vider le cache (développement)
```bash
docker exec -it redis-beldetailing-dev redis-cli FLUSHDB
```

### Voir toutes les clés
```bash
docker exec -it redis-beldetailing-dev redis-cli KEYS "*"
```

### Voir les clés de cache
```bash
docker exec -it redis-beldetailing-dev redis-cli KEYS "cache:*"
```

### Statistiques mémoire
```bash
docker exec -it redis-beldetailing-dev redis-cli INFO memory
```

## 📊 Comparaison

| Feature | Docker Local | Redis Cloud |
|---------|--------------|-------------|
| **Coût** | Gratuit | FREE: 0$/mois |
| **Latence** | ~1ms | ~5-10ms |
| **Quota** | Illimité | 30 MB (FREE) |
| **Backup** | Manuel | Automatique |
| **Monitoring** | Logs Docker | Dashboard |
| **Scalabilité** | 1 instance | Partageable |
| **Internet** | Non requis | Requis |

## 🎯 Recommandation

### Développement Local
👉 **Utilisez Docker** (`redis://localhost:6379`)
- Tests rapides
- Pas de consommation de quota
- Peut vider le cache facilement

### Production/Staging
👉 **Utilisez Redis Cloud** (votre instance)
- Fiabilité
- Monitoring
- Backup automatique
- Partageable entre instances

## ⚠️ Important

**Ne démarrez pas les deux en même temps !**

Si vous utilisez Docker local, assurez-vous que Redis Cloud n'est pas utilisé dans `.env` et vice versa.

## 🔍 Troubleshooting

### Redis ne démarre pas
```bash
# Vérifier les logs
docker-compose logs redis

# Vérifier si le port 6379 est déjà utilisé
lsof -i :6379
```

### Port déjà utilisé
```bash
# Arrêter l'autre instance Redis
docker-compose down
# OU
brew services stop redis
```

### Vider les données Docker
```bash
docker-compose down -v
# Supprime aussi le volume de données
```
