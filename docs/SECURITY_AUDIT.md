# 🔐 Audit de sécurité – Backend BelDetailing

Ce document liste ce qui est déjà en place et ce qu’il reste à faire pour renforcer la sécurité.

**Contexte** : Client **iOS uniquement** (pas d’app web). Les requêtes API viennent de l’app mobile ; CORS reste utile si un jour un dashboard web ou un outil externe appelle l’API.

---

## ✅ Déjà en place

| Élément | Détail |
|--------|--------|
| **Auth** | JWT Supabase vérifié via `requireAuth` (token valide + `getUser`) |
| **Autorisation par rôle** | Vérifications `req.user.role === "provider"` / `"company"` / `"customer"` dans les controllers |
| **Ownership** | Vérification que la ressource appartient à l’utilisateur (ex. `booking.provider_id === providerProfileId`) |
| **Helmet** | Headers de sécurité (XSS, clickjacking, etc.) |
| **Rate limiting** | 300 requêtes / 15 min par IP (global) |
| **Webhook Stripe** | Signature vérifiée avec `STRIPE_WEBHOOK_SECRET` |
| **Cron** | Routes cron protégées par `CRON_SECRET` |
| **Chat** | Sanitization du contenu (coordonnées, infos perso) dans `chatValidation.service.js` |
| **Supabase** | Requêtes paramétrées (pas de concat SQL brut → pas d’injection SQL directe) |

---

## ⚠️ À renforcer (priorité haute)

### 1. Rôle utilisateur depuis la base, pas seulement le JWT ✅ FAIT

- **Risque** : `req.user.role` venait de `user_metadata` du JWT.
- **Implémenté** : Dans `auth.middleware.js`, après `getUser(token)`, le rôle est chargé depuis `public.users` (par `user.id`) et utilisé pour `req.user.role`. La base est la source de vérité.

### 2. PATCH /bookings/:id – whitelist des champs ✅ FAIT

- **Risque** : Tout `req.body` était envoyé à `updateBookingService`.
- **Implémenté** : Seuls les champs autorisés sont mis à jour : `address`, `date`, `start_time`, `end_time`, `customer_address_lat`, `customer_address_lng`, `transport_fee`, `transport_distance_km`. Les champs critiques (`status`, `payment_status`, `progress`, etc.) ne sont plus modifiables via PATCH.

### 3. CORS ✅ FAIT

- **Risque** : Aucune config CORS (utile si un jour dashboard web ou app tierce appelle l’API).
- **Implémenté** : Middleware `cors` ajouté. Origine(s) configurable(s) via `CORS_ORIGIN`. Client actuel = iOS uniquement ; CORS en place pour toute évolution future (web, outils admin).

### 4. Validation des entrées (body / query) ✅ FAIT

- **Risque** : Beaucoup d’endpoints utilisaient `req.body` ou `req.query` sans schéma strict.
- **Implémenté** : express-validator sur les routes sensibles :
  - **Auth** : register, login, refresh (auth.validator.js)
  - **Booking** : POST (createBookingValidation), PATCH (patchBookingValidation, whitelist + types/longueurs)
  - **Profile** : PATCH (updateProfileValidation, longueurs + types pour phone, vatNumber, customerProfile, companyProfile, providerProfile)
  - **Offre** : POST (createOfferValidation)
  - **Paiement** : intent, capture, refund (payment.validator.js)

### 5. PATCH /profile – rejet explicite de `role`

- **Fait** : Le body n’est pas spread ; seuls `phone`, `vatNumber`, `customerProfile`, etc. sont utilisés. Rejet explicite si `req.body.role` est envoyé en dehors de la transition provider_passionate → provider (voir code).

### 6. Vérification d’ownership sur toutes les ressources

- **À auditer** : Pour chaque route qui modifie une ressource (booking, offer, service, profil), s’assurer que l’utilisateur est bien le propriétaire (ou admin). Beaucoup de controllers le font déjà ; vérifier les routes récentes ou peu utilisées.

---

## 📋 À considérer (priorité moyenne)

| Sujet | Action |
|-------|--------|
| **Rate limit** | 300/15 min est large. Envisager des limites plus basses par type de route (ex. auth, création de booking). |
| **Logs** | Éviter de logger des tokens ou données sensibles (card, email en clair dans tous les logs). |
| **Secrets** | Vérifier que `STRIPE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` ne sont jamais exposés (env uniquement, pas dans le code). |
| **PATCH /profile** | ✅ Le champ `role` n’est plus mis à jour depuis le body (uniquement via la transition provider_passionate → provider lors de l’ajout de la TVA). |
| **IDs dans l’URL** | Les UUIDs réduisent l’énumération ; pas de changement nécessaire si tout est déjà en UUID. |

---

## 🔮 Bonnes pratiques long terme

- **Audit des dépendances** : `npm audit` / Snyk régulièrement.
- **HTTPS uniquement** : En production, redirection HTTP → HTTPS et HSTS.
- **Limite de taille du body** | `express.json({ limit: "500kb" })` pour éviter des payloads énormes.
- **Role-based middleware** | Créer `requireRole("provider")`, `requireRole("company")` pour éviter la duplication et les oublis.
- **Tests de sécurité** | Quelques tests d’intégration : accès interdit sans token, accès à une ressource d’un autre utilisateur → 403.

---

## Résumé

- **Réalisé** : Rôle depuis la DB, whitelist PATCH booking, CORS, rejet explicite de `role` en PATCH profile, limite body 500kb, validation des entrées (auth, booking create/PATCH, profile PATCH, offre create, paiement).
- **À faire** : Audit d’ownership sur les routes récentes ou peu utilisées.
- **Contexte** : Pas d’app web — client = **iOS uniquement**. La base est saine (auth JWT, ownership, pas de SQL brut, rate limit, Helmet). Les points listés ci-dessus renforcent la confiance et la conformité.
