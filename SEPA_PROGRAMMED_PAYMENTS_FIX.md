# 🔧 Fix : Paiements SEPA programmés bloqués par Stripe

## 🔴 Problème actuel

Les paiements SEPA mensuels échouent avec l'erreur Stripe :
```
There was an unexpected error while processing your request
```

**Cause** : Stripe bloque les paiements SEPA avec `off_session: true` si le mandate n'a jamais été utilisé en `on_session` avant (règle anti-fraude).

## ✅ Solution

### Étape 1 : Ne PAS créer automatiquement les PaymentIntents programmés

Lors de la création du payment schedule (`createIntelligentPaymentSchedule`), **ne pas** appeler `createPaymentIntentForMission` pour les paiements `monthly` et `final`.

Les paiements sont créés en DB (`mission_payments`) avec `status: 'pending'`, mais **sans PaymentIntent Stripe**.

### Étape 2 : Créer les PaymentIntents après le premier paiement on-session

Après que le premier paiement (deposit + commission) réussisse via le webhook `payment_intent.succeeded`, créer automatiquement les PaymentIntents pour les paiements programmés restants.

### Étape 3 : Utiliser un cron job pour les paiements mensuels

Un cron job quotidien vérifie les paiements `pending` dont la `scheduled_date` est proche et crée les PaymentIntents avec `off_session: true` (maintenant autorisé car le mandate a été utilisé).

## 📋 Modifications backend

### 1. `missionPaymentScheduleIntelligent.service.js`

```javascript
// ⚠️ Ne PAS autoriser automatiquement
if (authorizeAll) {
  console.log(`⚠️ [PAYMENT SCHEDULE] Skipping automatic authorization`);
  console.log(`⚠️ [PAYMENT SCHEDULE] PaymentIntents will be created after first on-session payment`);
  // Ne pas créer les PaymentIntents maintenant
}
```

### 2. `stripeWebhook.routes.js` - webhook `payment_intent.succeeded`

Après le succès du premier paiement combiné :

```javascript
// ✅ NOUVEAU : Créer les PaymentIntents pour les paiements programmés
const { data: scheduledPayments } = await supabase
  .from("mission_payments")
  .select("*")
  .eq("mission_agreement_id", missionAgreementId)
  .eq("status", "pending")
  .not("type", "eq", "commission")
  .not("type", "eq", "deposit");

console.log(`🔄 [WEBHOOK] Creating PaymentIntents for ${scheduledPayments.length} scheduled payments`);

for (const payment of scheduledPayments) {
  try {
    const { createPaymentIntentForMission } = await import("../services/missionPaymentStripe.service.js");
    await createPaymentIntentForMission({
      missionAgreementId,
      paymentId: payment.id,
      amount: payment.amount,
      type: payment.type,
    });
    console.log(`✅ [WEBHOOK] PaymentIntent created for ${payment.type} payment ${payment.id}`);
  } catch (err) {
    console.error(`❌ [WEBHOOK] Failed to create PaymentIntent for ${payment.id}:`, err);
  }
}
```

### 3. Cron job de capture mensuelle

Le cron job `captureScheduledPayments` (déjà existant) se chargera de capturer les paiements dont la date approche.

## 📱 Modifications iOS

### Structure de réponse backend

Le backend renvoie :
```json
{
  "data": {
    "scheduleType": "long_mission",
    "durationDays": 30,
    "durationMonths": 1,
    "payments": [...],
    "summary": {
      "totalAmount": 2000,
      "depositAmount": 400,
      ...
    }
  }
}
```

### Correction iOS

Dans `MissionAgreementService.swift`, la fonction `createPaymentSchedule` renvoie déjà `PaymentScheduleResponse` qui contient `schedule: PaymentScheduleData`.

Dans `MissionPaymentViewModel.swift`, accéder au summary via :
```swift
self.paymentSchedule = response.schedule.summary
```

Ceci est déjà correct après la modification.

## 🎯 Résultat attendu

1. Company accepte l'application → Mission Agreement créé
2. Company confirme le contrat → Dates définies
3. Detailer accepte le contrat → `status: "agreement_fully_confirmed"`
4. Company crée les paiements → Paiements créés en DB, **SANS PaymentIntents Stripe**
5. Company confirme le paiement on-session → Premier paiement (deposit + commission) réussit
6. Webhook `payment_intent.succeeded` → **Crée automatiquement les PaymentIntents pour les paiements restants**
7. Cron job quotidien → Capture les paiements mensuels à leurs dates prévues

✅ Plus d'erreurs Stripe car tous les paiements `off_session` sont créés APRÈS le premier paiement on-session.
