# 🔧 Debug Server Startup

Si le serveur ne démarre pas ou redémarre en boucle :

## Solution 1 : Démarrer sans nodemon (pour tester)

```bash
node src/server.js
```

Si ça fonctionne, le problème vient de nodemon.

## Solution 2 : Nettoyer et redémarrer

```bash
# Arrêter tous les processus
pkill -f nodemon
pkill -f node

# Attendre 2 secondes
sleep 2

# Redémarrer
npm run dev
```

## Solution 3 : Vérifier les fichiers modifiés

```bash
# Voir les fichiers modifiés récemment
find src -type f -mmin -1 | head -20

# Vérifier les processus qui accèdent aux fichiers
lsof +D src 2>/dev/null | head -20
```

## Solution 4 : Mode debug nodemon

```bash
nodemon --verbose --delay 5000 src/server.js
```

## Solution 5 : Désactiver le watch temporairement

Modifier `nodemon.json` et mettre `"watch": false` pour tester.
