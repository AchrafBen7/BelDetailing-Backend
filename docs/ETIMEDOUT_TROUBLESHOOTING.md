# Erreur ETIMEDOUT au démarrage du backend

## Symptôme

```
Error: ETIMEDOUT: connection timed out, read
    at Object.readSync (node:fs:739:18)
    at getSourceSync (node:internal/modules/esm/load:37:14)
```

Le serveur plante au chargement des modules (avant même d’afficher les logs de l’app).

---

## Cause

Node lit les fichiers `.js` du projet depuis le disque. Si le projet est dans un **dossier synchronisé** (iCloud Drive, OneDrive, Dropbox, Google Drive, ou un lecteur réseau), les lectures peuvent être lentes ou bloquantes et dépasser le délai → **ETIMEDOUT**.

Typique quand le projet est dans :
- `~/Documents/...` (souvent synchronisé avec iCloud sur macOS)
- Un dossier iCloud Drive
- Un partage réseau / NAS

---

## Solutions (par ordre de simplicité)

### 1. Lancer sans nodemon (pour tester)

Nodemon surveille beaucoup de fichiers ; avec un FS synchronisé, ça peut aggraver le problème.

```bash
npm start
# ou
node src/server.js
```

Si le serveur démarre avec `npm start` mais plante avec `npm run dev` (nodemon), le problème vient bien du chemin + surveillance des fichiers.

---

### 2. Déplacer le projet hors du dossier synchronisé

Déplacer **tout le repo** (ou au moins le backend) vers un dossier **local non synchronisé** :

- macOS : par exemple `~/Projects/NIOS` ou `~/Developer/NIOS`
- Éviter : `~/Documents`, `~/Desktop`, `~/Library/Mobile Documents/`

Après déplacement :

```bash
cd ~/Projects/NIOS/Backend/BelDetailing-Backend
npm run dev
```

---

### 3. Désactiver la synchronisation iCloud pour ce dossier (macOS)

1. **Réglages Système** → **Apple ID** → **iCloud** → **iCloud Drive** → **Options**.
2. Décocher **Bureau et documents** (ou exclure le dossier qui contient NIOS).

Ou : déplacer uniquement le projet hors de `Documents` (solution 2).

---

### 4. Utiliser un dossier local pour le dev (clone secondaire)

Garder le projet principal où tu veux, et faire le dev dans un clone sur un disque local :

```bash
# Exemple : clone dans un dossier local
cp -R /Users/.../Documents/Cleanny/NIOS ~/Projects/NIOS-dev
cd ~/Projects/NIOS-dev/Backend/BelDetailing-Backend
npm install
npm run dev
```

---

### 5. Réduire la charge de nodemon (si tu restes en synced)

Dans `nodemon.json`, tu peux augmenter le délai avant redémarrage et limiter ce qui est surveillé. Ça peut aider un peu, mais **la solution fiable reste de sortir du dossier synchronisé**.

---

## Vérification rapide

Pour voir si le chemin est dans iCloud (macOS) :

```bash
# Depuis la racine du backend
pwd
# Si tu vois quelque chose comme :
# /Users/tonuser/Library/Mobile Documents/com.apple.bird/...  → iCloud
# /Users/tonuser/Documents/...                                 → souvent iCloud
# /Users/tonuser/Projects/... ou /Users/tonuser/Developer/...    → en général local
```

---

## Résumé

| Solution | Effort | Efficacité |
|----------|--------|------------|
| Lancer avec `npm start` au lieu de `npm run dev` | Faible | Pour confirmer la cause |
| Déplacer le projet hors de Documents/iCloud | Moyen | **Recommandé** |
| Désactiver iCloud pour Documents | Moyen | Dépend de ton usage iCloud |
| Clone dans ~/Projects pour le dev | Faible | Très fiable |

L’erreur ne vient **pas** d’un bug dans ton code ni d’une config réseau du backend, mais du **système de fichiers** sur lequel se trouve le projet.
