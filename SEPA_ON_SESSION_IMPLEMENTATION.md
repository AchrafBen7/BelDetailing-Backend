# 🔐 SEPA ON-SESSION Implementation - Résolution des blocages Stripe Radar

## 🎯 Problème résolu

Les paiements SEPA étaient bloqués par Stripe Radar car ils étaient créés automatiquement avec `off_session: true` sans action humaine visible. Stripe considérait cela comme un risque élevé de fraude.

## ✅ Solution implémentée

### 🔑 RÈGLE N°1 — SEPA = ON-SESSION OBLIGATOIRE AU PREMIER DÉBIT

Le premier paiement SEPA doit être confirmé par la company, dans l'app, avec une action claire : "Confirmer le prélèvement de X € pour cette mission".

**Techniquement** :
- `off_session: false` (ON-SESSION)
- `confirm: true` (confirmation immédiate)
- Mandat déjà existant → OK

### 🔑 RÈGLE N°2 — UN SEUL PaymentIntent (Acompte + Commission)

Au lieu de créer deux PaymentIntents séparés (commission + acompte), on crée **UN SEUL PaymentIntent** qui combine les deux montants.

**Avantages** :
- Stripe voit un prélèvement clair, logique, contractuel
- Radar baisse drastiquement le risque
- Modèle validé par les marketplaces (Uber, Malt, Upwork)

## 📋 Flow complet

### Étape 1 : Contrat accepté (Company + Detailer)
- Company confirme le contrat → statut = `waiting_for_detailer_confirmation`
- Detailer accepte le contrat → statut = `agreement_fully_confirmed`
- **AUCUN débit automatique**

### Étape 2 : Écran "CONFIRMER LE PAIEMENT" (Company)
- Texte clair : "Pour activer la mission, veuillez confirmer le prélèvement SEPA de X € (acompte + frais NIOS)."
- Bouton : "Confirmer et payer"
- **Endpoint** : `POST /api/v1/mission-agreements/:id/confirm-payment`

### Étape 3 : Création du PaymentIntent ON-SESSION
- **Service** : `missionPaymentOnSession.service.js`
- **PaymentIntent** :
  - `amount`: acompte + commission (ex: 810€ = 600€ + 210€)
  - `off_session: false` ✅ CRITICAL
  - `confirm: true` ✅ Confirmation immédiate
  - `capture_method: "automatic_async"` (SEPA est asynchrone)
  - `transfer_group: "mission_{agreementId}"` (pour le transfer planifié)

### Étape 4 : Paiement "processing"
- Statut = `processing` (NORMAL pour SEPA)
- Mission = `active`
- Detailer INFORMÉ (SEPA = async, c'est normal)

### Étape 5 : Webhook `payment_intent.succeeded`
- Mission passe à `active` (si pas déjà)
- Commission acquise (reste sur la plateforme)
- Acompte : vérifier si J+1 → créer Transfer vers detailer

### Étape 6 : Transfer planifié (J+1)
- **Webhook** : Si `payment_intent.succeeded` ET J+1 → Transfer immédiat
- **Cron job** : Vérifier les acomptes en attente de transfer (J+1 atteint)
- **Transfer** : Montant complet de l'acompte (pas de commission, déjà capturée)

## 🔧 Modifications techniques

### Backend

1. **`missionAgreementUpdate.service.js`**
   - `acceptMissionAgreementByDetailer` : Ne crée plus de PaymentIntent automatiquement
   - Statut passe à `agreement_fully_confirmed` (au lieu de `active`)
   - Notifications mises à jour

2. **`missionPaymentOnSession.service.js`** (NOUVEAU)
   - `confirmMissionPaymentOnSession` : Crée UN SEUL PaymentIntent (acompte + commission)
   - `off_session: false` ✅
   - `confirm: true` ✅
   - Met à jour les deux paiements (commission + deposit) dans la DB

3. **`missionAgreement.controller.js`**
   - `confirmMissionPaymentController` : Nouvel endpoint pour la confirmation ON-SESSION

4. **`missionAgreement.routes.js`**
   - `POST /:id/confirm-payment` : Route pour la confirmation de paiement

5. **`stripeWebhook.routes.js`**
   - Gestion du `paymentType === "combined"` dans `payment_intent.succeeded`
   - Mise à jour des deux paiements (commission + deposit)
   - Vérification J+1 pour créer le Transfer

## 📱 iOS (À implémenter)

### Nouvel écran : MissionPaymentConfirmationView

```swift
struct MissionPaymentConfirmationView: View {
    let agreement: MissionAgreement
    @StateObject private var vm: MissionPaymentConfirmationViewModel
    
    var body: some View {
        VStack(spacing: 24) {
            // Header avec montants
            VStack(spacing: 8) {
                Text("Confirmer le paiement")
                    .font(.title2.bold())
                
                Text("\(vm.totalAmount)€")
                    .font(.system(size: 48, weight: .bold))
                    .foregroundColor(.black)
                
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text("Acompte")
                        Spacer()
                        Text("\(vm.depositAmount)€")
                    }
                    HStack {
                        Text("Commission NIOS")
                        Spacer()
                        Text("\(vm.commissionAmount)€")
                    }
                }
                .font(.subheadline)
                .foregroundColor(.gray)
            }
            .padding()
            
            // Bouton de confirmation
            Button {
                Task {
                    await vm.confirmPayment()
                }
            } label: {
                Text("Confirmer et payer")
                    .font(.headline)
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(Color.black)
                    .cornerRadius(12)
            }
            .disabled(vm.isConfirming)
        }
        .padding()
    }
}
```

### ViewModel

```swift
@MainActor
class MissionPaymentConfirmationViewModel: ObservableObject {
    @Published var isConfirming = false
    @Published var errorMessage: String?
    
    let agreement: MissionAgreement
    let totalAmount: Double
    let depositAmount: Double
    let commissionAmount: Double
    
    init(agreement: MissionAgreement) {
        self.agreement = agreement
        self.depositAmount = agreement.depositAmount
        self.commissionAmount = agreement.finalPrice * 0.07
        self.totalAmount = depositAmount + commissionAmount
    }
    
    func confirmPayment() async {
        isConfirming = true
        defer { isConfirming = false }
        
        do {
            let result = try await engine.missionAgreementService.confirmPayment(
                agreementId: agreement.id
            )
            
            // Succès → navigation ou notification
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
```

## 🎯 Résultat attendu

1. ✅ **Pas de blocage Stripe Radar** : Action humaine visible (`off_session: false`)
2. ✅ **Un seul prélèvement** : Plus clair pour Stripe et la company
3. ✅ **Transfer planifié** : Acompte transféré automatiquement à J+1
4. ✅ **Commission acquise** : Reste sur la plateforme dès le succès du paiement

## 📝 Notes importantes

- Le mandat SEPA doit être actif avant la confirmation de paiement
- Le detailer doit avoir un Stripe Connected Account configuré
- Le transfer de l'acompte est automatique à J+1 (via webhook ou cron job)
- La commission (7%) reste sur la plateforme et n'est pas transférée
