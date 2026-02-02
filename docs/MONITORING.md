# Monitoring et alertes — Backend BelDetailing

**Objectif :** Logs structurés, métriques et alertes pour la production.

---

## 1. Logs structurés (déjà en place)

- **Pino** : utilisé via `httpLogger` et `logger` dans `observability/logger.js`.
- Chaque requête HTTP a un `requestId` (header `x-request-id` ou généré).
- En production : utiliser `requestLogger(req)` dans les controllers pour logger avec le même `requestId` :

```js
import { requestLogger } from "../observability/logger.js";

export async function someController(req, res) {
  const log = requestLogger(req);
  try {
    // ...
  } catch (err) {
    log.error({ err }, "Operation failed");
    return res.status(500).json({ error: "..." });
  }
}
```

**Recommandations :**
- Remplacer progressivement `console.error` / `console.warn` par `logger` ou `requestLogger(req)` dans les controllers.
- En prod : envoyer stdout vers un service (Datadog, Logtail, Papertrail, etc.) ou laisser l’hébergeur agréger les logs.

---

## 2. Métriques (déjà en place)

- **Prometheus** : `prom-client` dans `observability/metrics.js`.
- Endpoint : `GET /metrics` (à monter dans `app.js` si ce n’est pas déjà fait).
- Métriques exposées :
  - `http_request_duration_ms` (histogramme par method, route, status_code)
  - `http_requests_total` (compteur)
  - Métriques métier : missions, paiements, transferts, factures, failed_transfers.

**À faire :**
- [ ] S’assurer que la route `/metrics` est protégée (par IP ou secret) en prod pour éviter l’exposition publique.
- [ ] Connecter Prometheus (ou équivalent) pour scraper `/metrics` et créer des dashboards (Grafana, dashboard hébergeur).

---

## 3. Alertes recommandées

| Alerte | Condition | Action suggérée |
|--------|-----------|------------------|
| **Taux d’erreur HTTP** | % de 5xx > 5 % sur 5 min | Vérifier logs, santé BDD et Stripe. |
| **Latence** | P95 > 2 s sur 5 min | Vérifier charge, requêtes lentes, Supabase. |
| **Stripe webhook** | Échec de signature ou 500 sur `/stripe/webhook` | Vérifier secret webhook et logs Stripe. |
| **Cron** | Cron non exécuté (ex. auto-capture) | Vérifier CRON_SECRET et scheduler (cron système ou hébergeur). |
| **Disque / mémoire** | Utilisation > 85 % | Augmenter ressources ou nettoyer. |

**Outils possibles :**
- Hébergeur : alertes intégrées (Railway, Render, etc.).
- Prometheus + Alertmanager + Grafana.
- Service SaaS : Better Uptime, Pingdom, Datadog, etc.

---

## 4. Health check

Exposer un endpoint simple pour le load balancer / hébergeur :

```js
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});
```

Optionnel : vérifier la connexion Supabase (et éventuellement Stripe) dans `/health` pour un “readiness” plus strict.

---

## 5. Résumé

| Élément | État | Action |
|--------|------|--------|
| Logs structurés | ✅ Pino en place | Utiliser `requestLogger(req)` dans les controllers ; envoyer stdout en prod. |
| Métriques | ✅ Prometheus en place | Protéger `/metrics` ; connecter à un outil de monitoring. |
| Alertes | ⚠️ À configurer | Définir seuils (5xx, latence, webhook, cron) sur l’outil choisi. |
| Health check | ✅ `/api/v1/health` | Optionnel : `GET /health` pour le LB. |

En appliquant ces points, le backend est prêt pour un monitoring de production correct.
