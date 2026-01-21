# 🔧 Configuration Redis - Guide Complet

## ✅ Votre Configuration Redis Cloud

### Informations Reçues :
- **Public Endpoint** : `redis-18398.c304.europe-west1-2.gce.cloud.redislabs.com:18398`
- **Région** : `europe-west1-2` (Belgium) 🇧🇪
- **Port** : `18398`
- **Mot de passe** : `FyKK4Jtj5mOAgnjiH2cz3OiNjmn3pbku`

## 📝 Configuration .env

### Option 1 : Redis Cloud (Production/Staging)

Ajoutez dans votre `.env` :

```env
# Redis Cloud (Production)
REDIS_URL=redis://default:FyKK4Jtj5mOAgnjiH2cz3OiNjmn3pbku@redis-18398.c304.europe-west1-2.gce.cloud.redislabs.com:18398
```

### Option 2 : Redis Local Docker (Développement)

Pour le développement local, utilisez Docker :

```env
# Redis Local (Développement)
REDIS_URL=redis://localhost:6379
```

## 🐳 Configuration Docker pour Développement Local

### 1. Créer docker-compose.yml

Créez un fichier `docker-compose.yml` à la racine du backend :

```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    container_name: redis-beldetailing-dev
    ports:
      - "6379:6379"
    command: redis-server --appendonly yes
    volumes:
      - redis-data:/data
    restart: unless-stopped

volumes:
  redis-data:
```

### 2. Démarrer Redis Local

```bash
# Démarrer Redis
docker-compose up -d

# Vérifier que Redis tourne
docker ps | grep redis

# Voir les logs
docker-compose logs redis
```

### 3. Tester Redis Local

```bash
# Test avec redis-cli
docker exec -it redis-beldetailing-dev redis-cli ping
# Devrait répondre : PONG

# OU avec redis-cli local (si installé)
redis-cli ping
```

## 🧪 Test de Connexion

### Test Redis Cloud

```bash
cd Backend/BelDetailing-Backend

# Ajoutez REDIS_URL dans .env
echo "REDIS_URL=redis://default:FyKK4Jtj5mOAgnjiH2cz3OiNjmn3pbku@redis-18398.c304.europe-west1-2.gce.cloud.redislabs.com:18398" >> .env

# Test avec le script
npm run test:redis
```

### Test avec redis-cli

```bash
# Test direct
redis-cli -u redis://default:FyKK4Jtj5mOAgnjiH2cz3OiNjmn3pbku@redis-18398.c304.europe-west1-2.gce.cloud.redislabs.com:18398 ping
# Devrait répondre : PONG
```

## 🔄 Stratégie : Dev vs Production

### Développement Local (Docker)
- ✅ **Gratuit** - Pas de coûts
- ✅ **Rapide** - Pas de latence réseau
- ✅ **Isolé** - Ne touche pas à Redis Cloud
- ✅ **Test facile** - Peut vider le cache facilement

**Configuration** :
```env
REDIS_URL=redis://localhost:6379
```

### Production/Staging (Redis Cloud)
- ✅ **Fiabilité** - 99.99% uptime
- ✅ **Scalabilité** - Partageable entre instances
- ✅ **Backup** - Sauvegarde automatique
- ✅ **Monitoring** - Dashboard Redis Cloud

**Configuration** :
```env
REDIS_URL=redis://default:FyKK4Jtj5mOAgnjiH2cz3OiNjmn3pbku@redis-18398.c304.europe-west1-2.gce.cloud.redislabs.com:18398
```

## 🎯 Recommandation

### Pour le Développement :
1. Utilisez **Docker** (Redis local)
2. Configuration : `REDIS_URL=redis://localhost:6379`
3. Avantages : Gratuit, rapide, isolé

### Pour la Production :
1. Utilisez **Redis Cloud** (votre instance)
2. Configuration : `REDIS_URL=redis://default:password@host:port`
3. Avantages : Fiabilité, scalabilité, monitoring

## 📋 Checklist

- [ ] Redis Cloud créé ✅
- [ ] REDIS_URL ajouté dans `.env`
- [ ] Test de connexion : `npm run test:redis`
- [ ] Docker configuré (optionnel pour dev)
- [ ] Serveur backend démarre sans erreur

## 🚀 Prochaines Étapes

1. **Ajoutez REDIS_URL dans `.env`**
2. **Testez** : `npm run test:redis`
3. **Démarrez le serveur** : `npm run dev`
4. **Vérifiez les logs** : Vous devriez voir `✅ [Redis] Ready to accept commands`
