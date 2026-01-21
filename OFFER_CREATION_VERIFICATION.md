# ✅ Vérification de la Création d'Offre avec Catégories Multiples

## 📋 Résumé des Modifications

### iOS (Frontend)
- ✅ `OfferCreateViewModel`: Utilise `Set<ServiceCategory>` pour gérer plusieurs catégories
- ✅ `OfferCreateView`: Permet la sélection multiple via des pills cliquables
- ✅ Envoie `categories: ["interior", "exterior"]` au backend

### Backend
- ✅ `offer.service.js`: Accepte `categories` (array) ou `category` (string) pour compatibilité
- ✅ Gestion d'erreur si la colonne `categories` n'existe pas encore
- ✅ Logs détaillés pour le débogage

## 🔍 Vérifications à Effectuer

### 1. Migration SQL (OBLIGATOIRE)

**Exécutez cette migration dans Supabase SQL Editor :**

```sql
-- Ajouter la colonne categories (text[])
ALTER TABLE offers 
ADD COLUMN IF NOT EXISTS categories text[];

-- Mettre à jour les offres existantes
UPDATE offers 
SET categories = ARRAY[category] 
WHERE categories IS NULL AND category IS NOT NULL;

-- Créer un index pour les recherches
CREATE INDEX IF NOT EXISTS idx_offers_categories ON offers USING GIN (categories);

-- Documentation
COMMENT ON COLUMN offers.categories IS 'Array de catégories de service (ex: ["interior", "exterior"])';
```

**Ou utilisez le fichier de migration :**
```bash
# Le fichier se trouve dans:
Backend/BelDetailing-Backend/migrations/add_offer_categories_array.sql
```

### 2. Test de Création d'Offre

**Option A: Via le script de test (recommandé)**

```bash
cd Backend/BelDetailing-Backend
npm run test:offer
```

Ce script va :
- ✅ Vérifier si la colonne `categories` existe
- ✅ Créer une offre de test avec catégories multiples
- ✅ Vérifier que les données sont bien stockées
- ✅ Nettoyer en supprimant l'offre de test

**Option B: Via l'app iOS**

1. Connectez-vous avec un compte **company**
2. Allez dans le Dashboard Company
3. Cliquez sur "Créer une offre"
4. Sélectionnez **plusieurs catégories** (ex: Intérieur + Extérieur)
5. Remplissez les autres champs
6. Cliquez sur "Publier l'offre"

### 3. Vérification dans la Base de Données

**Dans Supabase SQL Editor, exécutez :**

```sql
-- Voir les dernières offres créées
SELECT 
  id,
  title,
  category,
  categories,
  vehicle_count,
  price_min,
  price_max,
  city,
  type,
  status,
  created_at
FROM offers
ORDER BY created_at DESC
LIMIT 5;
```

**Résultat attendu :**
- `category` : Première catégorie (ex: "interior")
- `categories` : Array de toutes les catégories (ex: ["interior", "exterior"])

### 4. Vérification des Logs Backend

Lors de la création d'une offre, vous devriez voir dans les logs :

```
[OFFERS] Creating offer with payload: {
  title: "...",
  category: "interior",
  categories: ["interior", "exterior"],
  vehicle_count: 5,
  price_min: 200,
  price_max: 500,
  city: "Bruxelles",
  type: "oneTime"
}
[OFFERS] Offer created successfully: {
  id: "...",
  title: "...",
  category: "interior",
  categories: ["interior", "exterior"]
}
```

## 🐛 Dépannage

### Erreur: "column 'categories' does not exist"

**Solution :** Exécutez la migration SQL (voir section 1)

### Erreur: "new row violates row-level security policy"

**Solution :** Vérifiez les RLS policies sur la table `offers` :
```sql
-- Vérifier les policies
SELECT * FROM pg_policies WHERE tablename = 'offers';

-- Si nécessaire, créer une policy pour les companies
CREATE POLICY "Companies can create offers"
ON offers FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'company'
  )
);
```

### Les catégories ne sont pas stockées

**Vérifications :**
1. ✅ La migration SQL a été exécutée
2. ✅ Le backend reçoit bien `categories: [...]` dans le payload
3. ✅ Les logs backend montrent `categories: [...]` dans `insertPayload`
4. ✅ Aucune erreur dans les logs lors de l'insertion

## 📊 Structure de Données

### Payload iOS → Backend
```json
{
  "title": "Nettoyage complet",
  "description": "...",
  "categories": ["interior", "exterior"],
  "vehicleCount": 5,
  "priceMin": 200,
  "priceMax": 500,
  "city": "Bruxelles",
  "postalCode": "1000",
  "type": "oneTime"
}
```

### Stockage en Base de Données
```sql
-- Table: offers
category: "interior"              -- Première catégorie (compatibilité)
categories: ["interior", "exterior"]  -- Toutes les catégories (array)
```

### Réponse API → iOS
```json
{
  "id": "...",
  "title": "Nettoyage complet",
  "category": "interior",  // Première catégorie (pour compatibilité iOS)
  "description": "...",
  ...
}
```

## ✅ Checklist de Vérification

- [ ] Migration SQL exécutée dans Supabase
- [ ] Script de test `npm run test:offer` passe sans erreur
- [ ] Création d'offre via l'app iOS fonctionne
- [ ] Les catégories multiples sont visibles dans la DB
- [ ] Les logs backend montrent les catégories correctement
- [ ] Aucune erreur dans les logs lors de la création

## 🎯 Prochaines Étapes (Optionnel)

Pour une meilleure intégration future, vous pourriez :

1. **Modifier le modèle iOS `Offer`** pour supporter un array de catégories :
   ```swift
   let categories: [ServiceCategory]?  // Au lieu de category: ServiceCategory
   ```

2. **Afficher toutes les catégories** dans les cartes d'offres (au lieu de juste la première)

3. **Filtrer par catégories multiples** dans la recherche d'offres

---

**Date de création :** 2026-01-21  
**Dernière mise à jour :** 2026-01-21
