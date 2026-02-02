# Checklist Backend Production — BelDetailing

**Objectif :** Déployer le backend en production (env, domaine, HTTPS, monitoring).

---

## 1. Variables d’environnement

| Variable | Description | Exemple (à ne pas commiter) |
|----------|-------------|-----------------------------|
| `NODE_ENV` | `production` | `production` |
| `PORT` | Port du serveur | `8080` ou laissé au hébergeur |
| `SUPABASE_URL` | URL du projet Supabase | `https://xxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Clé anon Supabase | `eyJ...` |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé service role | `eyJ...` |
| `STRIPE_SECRET_KEY` | Clé secrète Stripe **live** | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | Secret du webhook Stripe **live** | `whsec_...` |
| `CORS_ORIGIN` | Origines autorisées (séparées par des virgules) | `https://app.example.com` |
| `FRONTEND_BASE_URL` | URL front / app (onboarding Stripe, etc.) | `https://app.example.com` |
| `ONESIGNAL_APP_ID` | App ID OneSignal | UUID |
| `ONESIGNAL_REST_API_KEY` | Rest API Key OneSignal | `...` |
| `CRON_SECRET` | Secret pour protéger les routes cron | Chaîne aléatoire forte |
| `LOG_LEVEL` | Niveau de log (info, warn, error) | `info` |

**À faire :**
- [ ] Créer un fichier `.env.production` (ou config hébergeur) avec les valeurs **live**.
- [ ] Ne jamais commiter les clés ; utiliser les secrets du hébergeur (Vercel, Railway, Render, etc.).
- [ ] Passer Stripe en **live** : clé `sk_live_...`, webhook avec `whsec_...` pour l’URL prod.

---

## 2. Domaine et HTTPS

| Élément | Action |
|---------|--------|
| **Domaine** | Réserver un domaine (ex. `api.beldetailing.com`) et le pointer vers l’hébergeur. |
| **HTTPS** | Activer SSL/TLS (Let’s Encrypt ou certificat fourni par l’hébergeur). |
| **URL de base** | Configurer l’app iOS pour appeler `https://api.beldetailing.com` (ou équivalent) en prod. |

**À faire :**
- [ ] Configurer le DNS (A ou CNAME) vers l’IP/host de l’hébergeur.
- [ ] Vérifier que toutes les requêtes passent en HTTPS (redirection HTTP → HTTPS si besoin).
- [ ] Mettre à jour `Server.prod` (ou équivalent) côté iOS avec l’URL réelle.

---

## 3. Stripe en production

- [ ] Créer / activer le compte Stripe **live**.
- [ ] Remplacer `STRIPE_SECRET_KEY` par `sk_live_...`.
- [ ] Dans le Dashboard Stripe : Webhooks → ajouter l’URL prod (ex. `https://api.beldetailing.com/api/v1/stripe/webhook`).
- [ ] Copier le **Signing secret** du webhook et le mettre dans `STRIPE_WEBHOOK_SECRET`.
- [ ] Côté iOS : utiliser la clé publishable **live** (`pk_live_...`) dans Info.plist / config.

---

## 4. Base de données (Supabase)

- [ ] Utiliser le projet Supabase **production** (ou un second projet dédié prod).
- [ ] Vérifier que les migrations sont appliquées (tables, RLS, triggers).
- [ ] Sauvegardes automatiques activées (Supabase les propose par défaut).

---

## 5. Sécurité

- [ ] `NODE_ENV=production` pour désactiver les stacks de dev.
- [ ] Rate limiting déjà en place (300 req / 15 min) ; ajuster si besoin.
- [ ] CORS restreint à l’origine de l’app (et éventuellement admin).
- [ ] Routes cron protégées par `CRON_SECRET`.
- [ ] Aucune clé secrète dans le code ni dans le repo.

---

## 6. Logs et monitoring

- [ ] Les logs structurés (pino) sont déjà en place ; en prod, envoyer vers un service (ex. Datadog, Logtail, ou stdout pour le hébergeur).
- [ ] Métriques Prometheus exposées sur `/metrics` ; les connecter à un outil de monitoring (Grafana, hébergeur) si besoin.
- [ ] Alertes : voir `MONITORING.md` pour les seuils recommandés.

---

## 7. Déploiement

- [ ] Choisir un hébergeur (Railway, Render, Fly.io, VPS, etc.).
- [ ] Build : `npm ci && npm run build` (si applicable).
- [ ] Start : `node src/server.js` ou `npm start`.
- [ ] Health check : exposer un endpoint `/health` (ou équivalent) pour le load balancer.
- [ ] Tester après déploiement : auth, création de résa, webhook Stripe, cron.

---

**Résumé :** Env (dont Stripe live), domaine + HTTPS, Supabase prod, sécurité, logs/monitoring, déploiement et tests manuels.
