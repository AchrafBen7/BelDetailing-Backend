# 🔐 SEPA Critical Cases Implementation - Cas critiques implémentés

## ✅ Implémentations complétées

### 1️⃣ Gestion des échecs de paiement SEPA

#### Webhooks implémentés

- **`payment_intent.payment_failed`** ✅
  - Met à jour `mission_payments.status = "failed"`
  - Met à jour `mission_agreements.payment_status = "payment_failed"`
  - Met à jour `mission_agreements.status = "agreement_fully_confirmed"` (retour au statut précédent)
  - Envoie notifications à company et detailer

- **`payment_intent.requires_payment_method`** ✅
  - Met à jour `mission_payments.status = "failed"`
  - Met à jour `mission_agreements.payment_status = "requires_payment_method"`
  - Met à jour `mission_agreements.status = "agreement_fully_confirmed"`
  - Envoie notification à company pour mettre à jour le moyen de paiement

- **`payment_intent.canceled`** ✅
  - Met à jour `mission_payments.status = "failed"`
  - Met à jour `mission_agreements.payment_status = "canceled"`
  - Met à jour `mission_agreements.status = "agreement_fully_confirmed"`
  - Envoie notification à company

#### Règles appliquées

| Cas | Action |
|-----|--------|
| Paiement échoue | Mission = `payment_failed`, Status = `agreement_fully_confirmed` |
| Paiement annulé | Mission = `canceled`, Status = `agreement_fully_confirmed` |
| Aucun paiement valide | Mission ne démarre PAS (status reste `agreement_fully_confirmed`) |

### 2️⃣ Verrouillage anti-double paiement

#### Backend

- **Vérification `payment_status`** ✅
  - Si `payment_status !== "pending_confirmation"` → Refuser `/confirm-payment`
  - Erreur 400 avec message clair

- **Idempotency Key** ✅
  - Format : `mission_payment_{missionAgreementId}_{timestamp}`
  - Liée à `missionAgreementId`
  - Empêche les doubles paiements en cas de retry réseau

#### Protection contre

- ✅ Double clic sur "Confirmer le paiement"
- ✅ Retry sauvage côté mobile
- ✅ Refresh réseau iOS

### 3️⃣ Annulation avant J+1

#### Service : `missionCancellation.service.js`

**Règles implémentées** :

- **Avant J+1** :
  - ✅ Acompte : Refund automatique à la company
  - ✅ Commission : Conservée (non remboursable selon CGU)
  - ✅ Transfer : Pas encore exécuté → Pas de transfer

- **Après J+1** :
  - ✅ Acompte : Déjà transféré → Pas de refund automatique
  - ✅ Commission : Conservée
  - ✅ Message : "L'acompte est définitivement acquis au detailer à partir du jour J+1"

#### Endpoint

- `POST /api/v1/mission-agreements/:id/cancel`
- Body : `{ "reason": "..." }`
- Accessible par : Company ou Provider

### 4️⃣ Annulation après J+1

#### Gestion contractuelle

- ✅ Vérification du timing (avant/après J+1)
- ✅ Message clair selon le cas
- ✅ Pas de refund automatique si transfer déjà exécuté
- ✅ Notification explicite aux deux parties

### 5️⃣ Logs et audit

#### Colonnes ajoutées (migration)

- `payment_confirmed_at` : Timestamp de confirmation ON-SESSION
- `payment_status` : Statut du paiement (pending_confirmation, processing, succeeded, payment_failed, canceled, requires_payment_method)
- `scheduled_transfer_at` : Date planifiée pour le transfer (J+1)
- `transfer_executed_at` : Timestamp d'exécution du transfer
- `transfer_id` : Stripe Transfer ID
- `cancellation_reason` : Raison de l'annulation
- `cancellation_requested_at` : Timestamp de la demande d'annulation
- `cancellation_requested_by` : Qui a demandé l'annulation (company, detailer, system)
- `refund_amount` : Montant remboursé
- `refund_executed_at` : Timestamp du remboursement
- `refund_id` : Stripe Refund ID

#### Traçabilité complète

- ✅ "Pourquoi j'ai été débité ?" → `payment_confirmed_at` + `payment_status`
- ✅ "Quand l'acompte a été envoyé ?" → `transfer_executed_at` + `transfer_id`
- ✅ "Pourquoi la mission n'a pas démarré ?" → `payment_status` + `cancellation_reason`

### 6️⃣ Contrat = source de vérité

#### À ajouter dans le PDF du contrat

Les règles suivantes doivent être explicitement mentionnées dans le contrat généré :

1. **Paiement** :
   - Le paiement est débité lors de la confirmation ON-SESSION par la company
   - Le prélèvement SEPA prend 2-5 jours pour être confirmé par la banque

2. **Acompte** :
   - L'acompte est versé au detailer le jour J+1 (un jour après le début de la mission)
   - L'acompte est définitivement acquis au detailer à partir du jour J+1

3. **Échec de paiement** :
   - Si le paiement échoue, la mission ne démarre pas
   - La company doit mettre à jour son moyen de paiement pour réessayer

4. **Annulation** :
   - Avant J+1 : Acompte remboursé, commission conservée
   - Après J+1 : Acompte non remboursable (déjà transféré), commission conservée

## 📋 Checklist de conformité

- [x] Gestion `payment_failed`
- [x] Gestion `requires_payment_method`
- [x] Gestion `canceled`
- [x] Verrouillage anti-double paiement
- [x] Idempotency key
- [x] Annulation avant J+1 (refund auto)
- [x] Annulation après J+1 (pas de refund)
- [x] Colonnes d'audit complètes
- [x] Logs traçables
- [ ] Mise à jour du PDF du contrat (à faire dans `missionAgreementPdf.service.js`)

## 🎯 Prochaines étapes

1. **Mettre à jour le template PDF** pour inclure les règles de paiement et d'annulation
2. **Tester les webhooks** avec Stripe CLI
3. **Vérifier les notifications** pour tous les cas
4. **Documenter les CGU** pour les utilisateurs
