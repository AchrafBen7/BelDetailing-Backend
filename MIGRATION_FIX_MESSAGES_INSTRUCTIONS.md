# 🔧 Instructions - Exécuter la Migration SQL pour Messages

## ❌ Problème

L'erreur suivante apparaît dans les logs :
```
code: '23514',
message: 'new row for relation "messages" violates check constraint "messages_sender_role_check"'
```

**Cause** : La contrainte CHECK sur `sender_role` dans la table `messages` n'accepte que `'provider'` et `'customer'`, mais pas `'company'`.

---

## ✅ Solution

Exécuter la migration SQL pour mettre à jour la contrainte CHECK.

---

## 📋 Méthode 1 : Via Supabase Dashboard (Recommandé)

### Étapes :

1. **Ouvrir Supabase Dashboard**
   - Aller sur https://supabase.com/dashboard
   - Sélectionner votre projet

2. **Ouvrir SQL Editor**
   - Cliquer sur "SQL Editor" dans le menu de gauche
   - Cliquer sur "New query"

3. **Copier-coller le script suivant** :

```sql
-- Migration pour corriger la contrainte CHECK sur sender_role dans la table messages
-- La contrainte doit accepter 'provider', 'customer', et 'company'

-- 1) Supprimer l'ancienne contrainte si elle existe
ALTER TABLE messages 
DROP CONSTRAINT IF EXISTS messages_sender_role_check;

-- 2) Créer la nouvelle contrainte qui accepte provider, customer, et company
ALTER TABLE messages 
ADD CONSTRAINT messages_sender_role_check 
CHECK (sender_role IN ('provider', 'customer', 'company'));

-- 3) Vérifier que la contrainte est bien appliquée
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_constraint 
        WHERE conname = 'messages_sender_role_check'
        AND contype = 'c'
    ) THEN
        RAISE EXCEPTION 'La contrainte messages_sender_role_check n''a pas été créée correctement';
    ELSE
        RAISE NOTICE '✅ La contrainte messages_sender_role_check a été créée avec succès';
    END IF;
END $$;

-- 4) Vérifier que les valeurs acceptées sont correctes
SELECT 
    conname AS constraint_name,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conname = 'messages_sender_role_check';
```

4. **Exécuter le script**
   - Cliquer sur "Run" ou appuyer sur `Cmd+Enter` (Mac) / `Ctrl+Enter` (Windows)

5. **Vérifier le résultat**
   - Vous devriez voir un message de succès
   - La dernière requête SELECT devrait afficher la contrainte avec `('provider', 'customer', 'company')`

---

## 📋 Méthode 2 : Via psql (Ligne de commande)

### Prérequis :
- Avoir `psql` installé
- Avoir les credentials de connexion Supabase

### Étapes :

1. **Récupérer les credentials Supabase**
   - Aller dans Supabase Dashboard → Settings → Database
   - Copier "Connection string" (URI) ou utiliser "Host", "Database", "User", "Password"

2. **Exécuter la migration** :

```bash
# Option A : Avec URI
psql "postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres" -f Backend/BelDetailing-Backend/migrations/fix_messages_sender_role_check.sql

# Option B : Avec variables d'environnement
export PGHOST=[HOST]
export PGDATABASE=postgres
export PGUSER=postgres
export PGPASSWORD=[PASSWORD]
psql -f Backend/BelDetailing-Backend/migrations/fix_messages_sender_role_check.sql
```

---

## ✅ Vérification

Après avoir exécuté la migration, testez en envoyant un message depuis l'app iOS avec un utilisateur `company`.

**Vérification dans Supabase** :

```sql
-- Vérifier que la contrainte accepte bien 'company'
SELECT 
    conname AS constraint_name,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conname = 'messages_sender_role_check';

-- Résultat attendu :
-- constraint_name: messages_sender_role_check
-- constraint_definition: CHECK ((sender_role = ANY (ARRAY['provider'::text, 'customer'::text, 'company'::text])))
```

---

## 🐛 Si la Migration Échoue

### Erreur : "constraint already exists"
**Solution** : La contrainte existe déjà. Vérifiez qu'elle accepte bien `'company'` :

```sql
SELECT pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conname = 'messages_sender_role_check';
```

Si elle n'accepte pas `'company'`, supprimez-la d'abord :

```sql
ALTER TABLE messages DROP CONSTRAINT messages_sender_role_check;
```

Puis réexécutez la migration.

### Erreur : "permission denied"
**Solution** : Utilisez un compte avec les permissions `ALTER TABLE`. Vérifiez que vous utilisez le bon utilisateur (généralement `postgres`).

---

## 📝 Notes

- **Impact** : Cette migration est **non-destructive** - elle ne supprime aucune donnée
- **Temps d'exécution** : < 1 seconde
- **Rollback** : Si nécessaire, vous pouvez restaurer l'ancienne contrainte :

```sql
ALTER TABLE messages 
DROP CONSTRAINT messages_sender_role_check;

ALTER TABLE messages 
ADD CONSTRAINT messages_sender_role_check 
CHECK (sender_role IN ('provider', 'customer'));
```

---

**Fichier de migration** : `Backend/BelDetailing-Backend/migrations/fix_messages_sender_role_check.sql`
